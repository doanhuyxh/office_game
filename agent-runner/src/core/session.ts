import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExecutorConfig, RunnerConfig } from '../config';
import { sessionEnd, sessionStart } from '../executor/events';
import { modelMatches } from '../executor/model';
import { adapters, type RunOutcome, runExecutor } from '../executor/run';
import { errText, log, redact } from '../log';
import { RESUME_MAX_GAP_MIN } from '../policy';
import { type McpProfile, mcpConfig } from '../prompt';
import { MCP_SYSTEM_PROMPT } from '../prompt/system';
import { type Job, reportKind, type Store } from '../store';
import { AGENT_ENV, type Git, READONLY_ENV, TASK_ENV } from '../workspace';
import type { AgentState } from './agent';
import { agentEnv } from './env';
import { jobDir } from './paths';

/** Runner được dừng khi phiên CLI đang chạy — job về hàng đợi thay vì ghi lỗi. */
export class RunnerStopped extends Error {
  constructor() {
    super('runner dừng giữa phiên');
  }
}

/** Phiên CLI kết thúc bình thường: mã thoát 0, không hết giờ, CLI không báo lỗi. */
export const succeeded = (out: Pick<RunOutcome, 'exitCode' | 'timedOut' | 'isError'>) =>
  out.exitCode === 0 && !out.timedOut && !out.isError;

export interface SessionRequest {
  cwd: string;
  prompt: string;
  /** Id phiên CLI cũ để nối (xem {@link Sessions.resumeFor}). */
  resume?: string;
  /** Executor dùng cho phiên này; không đặt = executor của agent (chat / họp dùng `executor.light`). */
  exec?: ExecutorConfig;
  /** Chỉ tool MCP (mode none, chat, họp). */
  noBuiltinTools?: boolean;
  /** Phiên chỉ đọc (review, TEST-167): đặt `READONLY_ENV` → hook pre-push của runner chặn mọi push. */
  readOnly?: boolean;
  /** Có báo thao tác lên văn phòng 3D không. */
  presence: boolean;
  /** Tên phiên người xem trực tiếp thấy ("MÃ · tên việc"; chat / họp: nhãn chung, không có nội dung tin). */
  label: string;
}

/** Nơi phiên vừa chạy — ghi vào `task_sessions` để lần sau nối phiên / gửi transcript. */
export interface SessionPlace {
  cwd: string;
  branch?: string;
  /** Lần này nối phiên cũ. */
  resumed: boolean;
}

type JobRef = Pick<Job, 'id' | 'agent' | 'label'>;
const jobFields = (job: JobRef) => ({ job: job.id, agent: job.agent, task: job.label });

/**
 * Vòng đời một phiên CLI của job, dùng chung cho job việc / chat / họp: quyết định nối phiên → chạy CLI → ghi phiên + transcript → ghi kết quả
 * + mức dùng AI. Không biết gì về loại job (kiểm tra, workspace, publish nằm ở nơi gọi).
 */
export class Sessions {
  constructor(
    private readonly config: RunnerConfig,
    private readonly store: Store,
    private readonly git: Git,
  ) {}

  /**
   * Chạy CLI của agent cho một job: ghi prompt + cấu hình MCP vào thư mục tạm của job, env riêng (không kế thừa env runner), log từng thao tác.
   * Runner bị dừng giữa phiên → ném {@link RunnerStopped} (không ghi kết quả / bình luận "phiên lỗi").
   */
  async run(s: AgentState, job: Job, signal: AbortSignal, request: SessionRequest): Promise<RunOutcome> {
    const dir = jobDir(this.config.dataDir, job.id);
    const exec = request.exec ?? s.cfg.executor;
    const files = this.writeJobFiles(dir, job, request.prompt);
    const env = {
      ...agentEnv(s.cfg, this.git),
      OFFICEHUB_TOKEN: s.cfg.token,
      [AGENT_ENV]: job.agent,
      [TASK_ENV]: job.label,
      ...(request.readOnly ? { [READONLY_ENV]: '1' } : {}),
    };
    const onActivity = this.activityLogger(s, job, dir, request.presence);
    // Dòng đầu job ghi model: adapter claude tự báo từ sự kiện system/init; adapter khác chỉ biết model cấu hình.
    if (!adapters[exec.kind]?.activity)
      onActivity(`Model ${exec.model ? `${exec.model} (cấu hình)` : 'mặc định của CLI'}`);
    // Người đứng gần bot trong 3D xem trực tiếp: bắt đầu phiên → từng thao tác → kết thúc phiên. Bộ gửi chạy ở nền: job KHÔNG chờ nó
    // và lỗi của nó không tới được đây (lỗi 2026-11-14: chờ gửi nốt ở cuối job làm runner treo, không ghi kết quả / bình luận chi phí).
    s.activity.push(sessionStart(request.label, exec.model));
    let out: RunOutcome | undefined;
    try {
      out = await runExecutor(
        {
          cwd: request.cwd,
          jobDir: dir,
          promptFile: files.prompt,
          prompt: request.prompt,
          mcpConfigFile: files.mcp,
          resumeSessionId: request.resume,
          exec,
          noBuiltinTools: request.noBuiltinTools,
          systemPrompt: request.noBuiltinTools ? MCP_SYSTEM_PROMPT : undefined,
          onActivity,
          onEvent: s.activity.active ? (e) => s.activity.push(e) : undefined,
        },
        env,
        signal,
      );
    } finally {
      const failed = !out || !succeeded(out);
      s.activity.push(sessionEnd(out ? { ...out, isError: failed } : { isError: true }, request.label));
      s.activity.flushNow();
    }
    if (signal.aborted) throw new RunnerStopped();
    if (out.model && !out.modelFromConfig && !modelMatches(exec.model, out.model))
      log('warn', 'model thật khác cấu hình', { ...jobFields(job), model: out.model, configured: exec.model });
    return out;
  }

  /** Prompt + cấu hình MCP của job (hồ sơ tool theo loại job, TEST-143) — file riêng tư, runner xoá khi job xong. */
  private writeJobFiles(dir: string, job: Job, prompt: string) {
    mkdirSync(dir, { recursive: true });
    const files = { prompt: join(dir, 'prompt.md'), mcp: join(dir, 'mcp.json') };
    writeFileSync(files.prompt, prompt, { mode: 0o600 });
    // review / deploy dùng bộ tool việc (get_task, comment_task…)
    const mcp = mcpConfig(this.config.mcpUrl, reportKind(job.kind) as McpProfile);
    writeFileSync(files.mcp, JSON.stringify(mcp, null, 2), { mode: 0o600 });
    return files;
  }

  /** Mỗi thao tác của agent → log runner, nhãn văn phòng 3D (nếu bật), và `activity.log` (bản đọc được; `output.log` là stream-json thô). */
  private activityLogger(s: AgentState, job: Job, dir: string, presence: boolean) {
    return (action: string) => {
      log('info', 'agent đang làm', { ...jobFields(job), action });
      if (presence) s.presence.activity(action);
      try {
        appendFileSync(join(dir, 'activity.log'), redact(`${new Date().toTimeString().slice(0, 8)}  ${action}\n`));
      } catch {
        /* không chặn job vì log */
      }
    };
  }

  /**
   * Nối phiên CLI cũ của khoá job không (TEST-142) — chỉ khi RẺ hơn mở phiên mới:
   * cùng agent, lần chạy trước cách ≤ {@link RESUME_MAX_GAP_MIN} phút (cache prompt còn sống; xa hơn thì nối phiên = ghi lại cả transcript cũ
   * vào cache, đắt hơn phiên mới đọc lại từ OfficeHub), transcript còn ở máy (adapter có `hasSession`), chưa nối quá `maxResumes` lần liên tiếp.
   * `task_sessions` mất (máy mới) → thử bản trên cloud của đúng khoá này (TEST-144), không có thì phiên mới, không lỗi.
   */
  async resumeFor(s: AgentState, job: Job, cwd: string, maxResumes?: number): Promise<string | undefined> {
    const adapter = adapters[s.cfg.executor.kind];
    if (!adapter?.caps.resume) return undefined;
    const prev = this.store.session(job.key);
    if (!prev) return this.restoreFromCloud(s, job, cwd);
    if (!prev.session_id || prev.agent !== job.agent) return undefined;
    const fresh = (reason: string) => {
      log('info', `mở phiên mới (${reason})`, jobFields(job));
      return undefined;
    };
    const gapMin = (Date.now() - Date.parse(prev.updated_at)) / 60_000;
    if (!(gapMin <= RESUME_MAX_GAP_MIN))
      return fresh(`lần chạy trước cách ${Math.round(gapMin)} phút > ${RESUME_MAX_GAP_MIN}`);
    if (maxResumes !== undefined && (prev.resumes ?? 0) >= maxResumes)
      return fresh(`đã nối ${prev.resumes} lần liên tiếp`);
    if (adapter.hasSession && !adapter.hasSession(agentEnv(s.cfg, this.git).HOME!, cwd, prev.session_id))
      return (
        (await this.restoreFromCloud(s, job, cwd)) ?? fresh('không còn transcript ở máy, cloud không có bản dùng được')
      );
    return prev.session_id;
  }

  /** Khôi phục transcript của khoá job từ cloud (TEST-144); lỗi không chặn job — trả undefined = phiên mới. */
  private async restoreFromCloud(s: AgentState, job: Job, cwd: string): Promise<string | undefined> {
    if (!s.transcripts) return undefined;
    try {
      return await s.transcripts.restore(job.key, cwd);
    } catch (e) {
      log('warn', 'khôi phục transcript từ cloud lỗi — mở phiên mới', {
        job: job.id,
        agent: job.agent,
        error: errText(e),
      });
      return undefined;
    }
  }

  /**
   * Sau phiên: ghi phiên CLI của khoá job (để lần sau nối) rồi đưa transcript vào hàng chờ gửi lên cloud, kèm bản bàn giao = câu cuối của
   * agent (TEST-144; gửi ở nền, lỗi chỉ ghi log).
   */
  record(s: AgentState, job: Job, out: RunOutcome, place: SessionPlace) {
    this.store.saveSession(job.key, job.agent, out.sessionId ?? null, place.branch ?? '', place.cwd, place.resumed);
    if (!s.transcripts || !out.sessionId) return;
    this.store.markTranscript(job.key, reportKind(job.kind), out.summary?.trim() || null);
    void s.transcripts.flush().catch((e) => log('warn', 'gửi transcript lỗi', { agent: job.agent, error: errText(e) }));
  }

  /**
   * Ghi kết quả phiên vào hàng đợi (trạng thái, chi phí, token, model) rồi gửi mức dùng AI lên OfficeHub ở nền (TEST-135 — lỗi không ảnh hưởng job,
   * phiên chưa gửi được gửi lại theo nhịp). Trả `ok`.
   */
  finish(s: AgentState, job: Job, out: RunOutcome, extra: { note?: string; prUrl?: string } = {}): boolean {
    const ok = succeeded(out);
    this.store.finish(job.id, ok ? 'done' : 'failed', {
      reason: failureReason(out) ?? (extra.note || null),
      session_id: out.sessionId ?? null,
      cost_usd: out.costUsd ?? null,
      input_tokens: out.inputTokens ?? null,
      output_tokens: out.outputTokens ?? null,
      turns: out.turns ?? null,
      pr_url: extra.prUrl ?? null,
      model: out.model ? out.model + (out.modelFromConfig ? ' (cấu hình)' : '') : null,
      model_usage: out.modelUsage ? JSON.stringify(out.modelUsage) : null,
      cache_read_tokens: out.cacheReadTokens ?? null,
      cache_write_tokens: out.cacheWriteTokens ?? null,
      executor: s.cfg.executor.kind,
      cli_ran: 1,
    });
    const usageSent = s.usage
      .flush()
      .catch((e) => log('warn', 'gửi mức dùng AI lỗi', { agent: job.agent, error: errText(e) }));
    // Dòng đánh dấu kết thúc, in sau khi gửi xong mức dùng AI + transcript (flush transcript gọi chồng → chờ lượt đang gửi).
    void Promise.allSettled([usageSent, s.transcripts?.flush()]).then(() => console.log(`====${job.label}=====done==`));
    log(ok ? 'info' : 'warn', 'xong job', {
      job: job.id,
      task: job.label,
      ok,
      model: out.model,
      pr: extra.prUrl,
      cost: out.costUsd,
      sec: out.durationSec,
    });
    return ok;
  }
}

/** Lý do phiên hỏng ghi vào `jobs.reason`; phiên ổn → undefined. */
function failureReason(out: RunOutcome): string | undefined {
  if (out.timedOut) return 'hết giờ';
  if (out.isError) return `CLI báo lỗi (${out.errorKind ?? out.exitCode})`;
  if (out.exitCode !== 0) return `mã thoát ${out.exitCode}`;
  return undefined;
}
