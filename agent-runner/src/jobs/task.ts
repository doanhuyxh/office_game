import type { AgentState } from '../core/agent';
import { RunnerStopped, succeeded } from '../core/session';
import { modelLine } from '../executor/model';
import type { RunOutcome } from '../executor/run';
import { log } from '../log';
import { buildPrompt } from '../prompt';
import type { Job } from '../store';
import { checkTask } from '../validator';
import { type PreparedWorkspace, WorkspaceRefused, workspaces } from '../workspace';
import { type JobHandler, type JobServices, skipJob, type WakeOf } from './handler';

/** Trạng thái báo lên văn phòng 3D khi job việc kết thúc: tên việc + loại lỗi ngắn (không lỗi → rảnh). */
interface DeskNote {
  task: string;
  failure?: string;
}

/**
 * Job việc — tin đánh thức việc được giao: hỏi lại OfficeHub (đúng dự án, vẫn giao cho agent, chưa xong, không chờ việc khác) → chuẩn bị nơi làm
 * theo `workspace.mode` → phiên CLI → đẩy sản phẩm (push + PR / push nhánh / không gì) → bình luận kết quả vào việc.
 * Văn phòng 3D (TEST-121): bắt đầu → đang làm; job hỏng → `error` kèm loại lỗi ngắn (giữ tới job kế); còn lại → rảnh.
 */
export function taskJobs(services: JobServices): JobHandler<WakeOf<'task'>> {
  const { config, store, sessions } = services;

  async function work(s: AgentState, job: Job, signal: AbortSignal, desk: DeskNote) {
    const wake: WakeOf<'task'> = {
      kind: 'task',
      employee_code: job.agent,
      project_id: job.project_id,
      task_id: job.key,
      task_code: job.label,
    };
    const checked = checkTask(await s.hub.getTask(job.key), wake, s.employeeId!);
    if (!checked.ok) return skipJob(store, job, checked.reason);
    const { title, dependsOn, blocks } = checked.value;
    s.presence.working(job.label, title);
    if (title.trim()) desk.task = `${job.label} · ${title.trim()}`;

    const strategy = workspaces[s.cfg.workspace.mode];
    let ws: PreparedWorkspace;
    try {
      ws = await strategy.prepare({ config, agent: s.cfg, git: services.gitFor(s.cfg) }, job);
    } catch (e) {
      if (!(e instanceof WorkspaceRefused)) throw e;
      // Workspace chưa sẵn sàng (đang bẩn / sai nhánh…) — không chạy agent, báo lại trong việc để người xử lý rồi giao lại.
      store.finish(job.id, 'skipped', { reason: e.message });
      desk.failure = 'Không chạy được';
      await s.hub.comment(job.key, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy: ${e.message}`);
      log('warn', 'bỏ job — workspace chưa sẵn sàng', { job: job.id, task: job.label, reason: e.message });
      return;
    }

    const workedBefore = !!store.session(job.key);
    const resume = await sessions.resumeFor(s, job, ws.path);
    // Phiên mới nhưng việc đã từng làm (worktree / nhánh local hoặc origin / phiên cũ) → prompt bảo đọc Bàn giao trước
    const continued = !resume && (ws.hasHistory || workedBefore);
    // Mode none + builtin_tools (TEST-163): vẫn không repo nhưng có công cụ của CLI. Phiên chat / họp không đi qua đây → vẫn chỉ MCP.
    const shell = strategy.mode === 'none' && s.cfg.workspace.builtinTools;
    const out = await sessions.run(s, job, signal, {
      cwd: ws.path,
      prompt: buildPrompt(wake, {
        mode: strategy.mode,
        branch: ws.branch,
        resumed: !!resume,
        continued,
        shell,
        related: { dependsOn, blocks },
      }),
      resume,
      noBuiltinTools: strategy.noBuiltinTools && !shell,
      presence: true,
      label: `${job.label} · ${title}`,
    });
    sessions.record(s, job, out, { cwd: ws.path, branch: ws.branch, resumed: !!resume });

    const published = await ws.publish(`${job.label}: ${title}`.slice(0, 200));
    const ok = succeeded(out);
    desk.failure = ok ? published.failure : presenceFailure(out);
    const comment = resultComment(job, out, published.prUrl, published.note, ok, s.cfg.executor.model);
    await s.hub.comment(job.key, comment);
    sessions.finish(s, job, out, { note: published.note, prUrl: published.prUrl });
  }

  return {
    kind: 'task',
    text: {
      skipped: 'bỏ qua việc',
      checkFailed: 'không kiểm tra được việc — bỏ qua',
      queued: 'xếp hàng việc',
      merged: 'việc đã có job đang chờ / chạy',
    },
    key: (wake) => wake.task_id,
    label: (wake) => wake.task_code,
    projectId: (wake) => wake.project_id,

    async admit(s, wake) {
      return checkTask(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
    },

    async run(s, job, signal) {
      const desk: DeskNote = { task: job.label };
      try {
        await work(s, job, signal, desk);
      } catch (e) {
        if (!(e instanceof RunnerStopped)) desk.failure = 'Runner lỗi'; // Runner.process ghi failed + log
        throw e;
      } finally {
        if (desk.failure)
          s.presence.error(desk.failure, { task: desk.task, taskId: job.key, projectId: job.project_id });
        else s.presence.idle();
      }
    },
  };
}

/** Loại lỗi ngắn của phiên hỏng cho bong bóng 3D (TEST-121) — không lộ stderr / lời agent. */
export function presenceFailure(out: Pick<RunOutcome, 'exitCode' | 'timedOut' | 'isError'>): string {
  if (out.timedOut) return 'Hết giờ';
  return out.isError ? 'CLI báo lỗi' : `Mã thoát ${out.exitCode}`;
}

/**
 * Bình luận runner gửi vào việc sau mỗi phiên: PR, thời gian, model (TEST-64), chi phí, token, trạng thái.
 * Không chép output của CLI (agent tự báo kết quả).
 */
export function resultComment(
  job: Pick<Job, 'agent'>,
  out: RunOutcome,
  prUrl: string | undefined,
  note: string,
  ok: boolean,
  configuredModel?: string,
): string {
  const status = ok ? 'phiên kết thúc' : out.timedOut ? 'HẾT GIỜ, đã dừng phiên' : 'phiên lỗi';
  const duration = `${Math.round(out.durationSec / 60)} phút${out.turns ? ` · ${out.turns} lượt` : ''}`;
  const lines = [
    `**🤖 agent-runner** (${job.agent}) — ${status}`,
    prUrl ? `- PR: ${prUrl}` : null,
    `- Thời gian: ${duration}`,
    `- Model: ${modelLine(out, configuredModel)}`,
    out.costUsd !== undefined ? `- Chi phí: ${costText(out)}` : null,
    // CLI không báo chi phí USD (vd codex) nhưng có token → vẫn ghi token
    out.costUsd === undefined && out.inputTokens ? `- Token: ${tokenText(out)}` : null,
    note ? `- ${note}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function costText(out: RunOutcome): string {
  const cost = `$${(out.costUsd ?? 0).toFixed(2)}`;
  return out.inputTokens ? `${cost} · ${tokenText(out)}` : cost;
}

function tokenText(out: RunOutcome): string {
  const tokens = (n: number) => n.toLocaleString('en');
  const cached = out.cacheReadTokens ? ` (${tokens(out.cacheReadTokens)} đọc từ cache)` : '';
  return `${tokens(out.inputTokens ?? 0)} token vào${out.costUsd === undefined ? cached : ''} / ${tokens(out.outputTokens ?? 0)} ra`;
}
