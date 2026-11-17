import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lightExecutor, type AgentConfig, type RunnerConfig } from './config';
import { agentEnv, agentHome } from './core/env';
import { jobDir, workDir } from './core/paths';
import { diagnoseAgent, gitUnavailable, type DoctorContext, type DoctorOptions } from './doctor/agent';
import { findingLogLevel, formatFinding, type Finding } from './doctor/finding';
import { modelLine, modelMatches } from './executor/model';
import { adapters, runExecutor, type RunOutcome } from './executor/run';
import type { ExecutorConfig } from './config';
import { errText, log, redact, registerSecret } from './log';
import { OfficeHubClient } from './officehub';
import { ActivitySender } from './activity';
import { sessionEnd, sessionStart } from './executor/events';
import { PresenceReporter } from './presence';
import { buildPrompt, mcpConfig } from './prompt';
import { RESUME_MAX_GAP_MIN } from './prompt/common';
import { chatPrompt } from './prompt/chat';
import { meetingPrompt } from './prompt/meeting';
import { MCP_SYSTEM_PROMPT } from './prompt/system';
import { Store, type Job } from './store';
import { TelegramClient, type TgMessage } from './telegram';
import { TranscriptReporter } from './transcript';
import { USAGE_RETRY_MS, UsageReporter, sourceHost } from './usage';
import {
  checkChat,
  checkMeeting,
  checkTask,
  parseWake,
  type ChatWake,
  type MeetingWake,
  type WakeData,
} from './validator';
import {
  AGENT_ENV,
  Git,
  TASK_ENV,
  WorkspaceRefused,
  branchChanges,
  inPlaceChanges,
  installHooks,
  mainBranchWarning,
  prepareInPlace,
  prepareWorktree,
  publish,
  pushInPlace,
  removeHooks,
} from './workspace';

interface AgentState {
  cfg: AgentConfig;
  hub: OfficeHubClient;
  tg: TelegramClient;
  /** Trạng thái đang làm / rảnh trong văn phòng 3D (bàn ↔ Khu nghỉ). */
  presence: PresenceReporter;
  /** Luồng "agent đang làm gì" cho người xem trực tiếp trong 3D (TEST-99). */
  activity: ActivitySender;
  /** Gửi chi phí / token mỗi phiên lên OfficeHub (TEST-135). */
  usage: UsageReporter;
  /** Gửi transcript phiên lên cloud + khôi phục lười (TEST-144) — chỉ adapter có transcript (`claude`). */
  transcripts?: TranscriptReporter;
  employeeId?: string;
  enabled: boolean;
  problem?: string;
  /** Model thật đọc được lúc chạy thử (`checkAgents`, TEST-64). */
  model?: string;
}

/** Runner được dừng khi phiên CLI đang chạy — job về hàng đợi thay vì ghi lỗi. */
export class RunnerStopped extends Error {
  constructor() {
    super('runner dừng giữa phiên');
  }
}

/** Bộ điều phối: Listener (Telegram) → Validator → Store (hàng đợi + khoá task_id) → Workspace → Executor → Publisher (PR + bình luận). */
export class Runner {
  readonly agents = new Map<string, AgentState>();
  private readonly abort = new AbortController();
  private readonly running = new Map<number, AbortController>();
  private usageTimer?: ReturnType<typeof setInterval>;
  /** Git của runner (env của runner); thao tác cho agent dùng `gitFor(agent)` (HOME / PATH của agent). */
  readonly git: Git;

  constructor(
    readonly config: RunnerConfig,
    readonly store: Store,
  ) {
    this.git = new Git(config.gitBin);
    const source = { host: sourceHost(), dbId: store.dbId() };
    for (const a of config.agents) {
      registerSecret(a.token);
      registerSecret(a.telegramToken);
      this.agents.set(a.employeeCode, {
        cfg: a,
        hub: new OfficeHubClient(config.mcpUrl, a.token),
        tg: new TelegramClient(config.telegramApiUrl, a.telegramToken),
        enabled: false,
        presence: new PresenceReporter(config.mcpUrl, a.token, a.employeeCode),
        activity: new ActivitySender(config.mcpUrl, a.token, a.employeeCode, config.activityStream),
        usage: new UsageReporter(config.mcpUrl, a.token, a.employeeCode, store, {
          ...source,
          executor: a.executor.kind,
        }),
        transcripts: adapters[a.executor.kind]?.hasSession
          ? new TranscriptReporter(config.mcpUrl, a.token, a.employeeCode, store, agentHome(a))
          : undefined,
      });
    }
  }

  /**
   * Kiểm tra từng agent (lệnh `doctor`, lúc khởi động, lệnh `run`) rồi bật / tắt agent theo kết quả: agent lỗi bị tắt riêng, các agent khác
   * vẫn chạy. Các bước kiểm tra nằm ở `doctor/agent.ts`. Git của runner không chạy được (TEST-46) → mọi agent có repo tắt.
   */
  async checkAgents(o: { only?: string } & Partial<DoctorOptions> = {}): Promise<Finding[]> {
    const options: DoctorOptions = { telegram: o.telegram ?? true, modelCheck: o.modelCheck ?? true };
    const findings: Finding[] = [];
    let gitError: string | undefined;
    try {
      findings.push({ level: 'ok', text: `git: ${await this.git.version()} (${this.config.gitBin})` });
    } catch (e) {
      gitError = errText(e);
    }
    for (const s of this.agents.values()) {
      if (o.only && s.cfg.employeeCode !== o.only) continue;
      const needsGit = s.cfg.workspace.mode !== 'none';
      const d =
        gitError && needsGit
          ? gitUnavailable(s.cfg.employeeCode, gitError)
          : await diagnoseAgent(this.doctorContext(s), options);
      findings.push(...d.findings);
      s.employeeId = d.employeeId ?? s.employeeId;
      s.model = d.model ?? s.model;
      s.enabled = !d.problem;
      s.problem = d.problem;
    }
    return findings;
  }

  private doctorContext(s: AgentState): DoctorContext {
    return {
      config: this.config,
      agent: s.cfg,
      env: this.envFor(s.cfg),
      git: this.gitFor(s.cfg),
      hub: s.hub,
      tg: s.tg,
    };
  }

  /** Biến môi trường cho tiến trình con của agent (xem {@link agentEnv}). */
  envFor(a: AgentConfig): Record<string, string> {
    return agentEnv(a, this.git);
  }

  /** Git với HOME / PATH của agent (credential helper, SSH key, user.name của HOME đó). */
  gitFor(a: AgentConfig) {
    return this.git.withEnv(this.envFor(a));
  }

  // ---------------- Listener ----------------

  /** Long polling getUpdates cho bot của từng agent; offset lưu SQLite → khởi động lại không xử lý lại tin cũ. */
  async listen(s: AgentState) {
    const bot = s.cfg.telegramBot;
    while (!this.abort.signal.aborted) {
      try {
        const updates = await s.tg.getUpdates(this.store.offset(bot));
        for (const u of updates) {
          this.store.setOffset(bot, u.update_id + 1);
          if (u.message) await this.onMessage(s, u.message);
        }
      } catch (e) {
        if (this.abort.signal.aborted) return;
        const wait = ((e as { retryAfter?: number }).retryAfter ?? 5) * 1000;
        log('warn', 'getUpdates lỗi', { agent: s.cfg.employeeCode, error: errText(e), retryMs: wait });
        await Bun.sleep(wait);
      }
    }
  }

  async onMessage(s: AgentState, msg: TgMessage) {
    const wake = parseWake(msg, {
      groupChatId: this.config.groupChatId,
      employeeCode: s.cfg.employeeCode,
    });
    if (!wake.ok) {
      log('info', 'bỏ qua tin Telegram', { agent: s.cfg.employeeCode, reason: wake.reason });
      return null;
    }
    if (wake.value.kind === 'meeting') return this.acceptMeeting(s, wake.value);
    return wake.value.kind === 'chat' ? this.acceptChat(s, wake.value) : this.accept(s, wake.value);
  }

  /**
   * Tin meeting_turn (TEST-84): hỏi lại OfficeHub (đúng phiên, đang giữ lượt) rồi xếp hàng, khoá theo `session_id`; job họp được lấy trước job khác.
   * Mỗi agent một phiên tại một thời điểm: agent đang chạy job VIỆC thì không dự họp được → runner bỏ lượt ngay (`pass_turn`) để cuộc họp
   * không đứng chờ hết hạn nói. Đang chạy job chat (ngắn) → xếp hàng, chạy ngay sau đó.
   */
  async acceptMeeting(s: AgentState, w: MeetingWake): Promise<number | null> {
    const label = meetingLabel(w.session_id),
      ctx = { agent: s.cfg.employeeCode, task: label };
    if (!s.enabled || !s.employeeId) {
      log('warn', 'agent đang tắt — bỏ qua', { ...ctx, problem: s.problem });
      return null;
    }
    try {
      const c = checkMeeting(await s.hub.myMeeting(), w.session_id);
      if (!c.ok) {
        log('info', 'bỏ qua lượt họp', { ...ctx, reason: c.reason });
        return null;
      }
      const busy = this.store.runningJob(s.cfg.employeeCode);
      if (busy && (busy.kind ?? 'task') === 'task') {
        await s.hub.passTurn();
        log('warn', 'agent đang làm việc — bỏ lượt họp', { ...ctx, busy: busy.task_code });
        return null;
      }
    } catch (e) {
      log('warn', 'không kiểm tra được cuộc họp — bỏ qua', { ...ctx, error: errText(e) });
      return null;
    }
    const id = this.store.enqueue(s.cfg.employeeCode, lightKey(s.cfg.employeeCode, w.session_id), label, '', 'meeting');
    log('info', id ? 'xếp hàng lượt họp' : 'cuộc họp đã có job đang chờ / chạy — gộp', { ...ctx, job: id });
    return id;
  }

  /**
   * Agent đang dự cuộc họp agent → job việc / chat chưa chạy (mỗi agent một phiên; lượt nói có thể tới bất cứ lúc nào): hoãn
   * {@link MEETING_HOLD_SEC} giây rồi kiểm tra lại. Không hỏi được (tài khoản không phải bot, OfficeHub bản cũ) → coi như không họp.
   */
  private async heldByMeeting(s: AgentState, job: Job): Promise<boolean> {
    let m: any;
    try {
      m = await s.hub.myMeeting();
    } catch {
      return false;
    }
    if (!m?.inMeeting) return false;
    const reason = 'agent đang họp — chờ hết cuộc họp';
    if (job.reason !== reason) log('info', 'hoãn job', { job: job.id, agent: job.agent, task: job.task_code, reason });
    this.store.hold(job.id, new Date(Date.now() + MEETING_HOLD_SEC * 1000).toISOString(), reason);
    return true;
  }

  /**
   * Tin chat_mention (TEST-81): hỏi lại OfficeHub (hội thoại còn tin @nhắc agent chưa đọc) rồi xếp hàng, khoá theo `conversation_id`.
   * Hội thoại đang có job chờ → gộp (job đó sẽ đọc cả tin mới); đang chạy → đánh dấu chạy thêm một lượt sau khi xong.
   */
  async acceptChat(s: AgentState, w: ChatWake): Promise<number | null> {
    const label = chatLabel(w.conversation_id);
    if (!s.enabled || !s.employeeId) {
      log('warn', 'agent đang tắt — bỏ qua', { agent: s.cfg.employeeCode, task: label, problem: s.problem });
      return null;
    }
    try {
      const c = checkChat(await s.hub.listChats(), w.conversation_id);
      if (!c.ok) {
        log('info', 'bỏ qua tin nhắc', { agent: s.cfg.employeeCode, task: label, reason: c.reason });
        return null;
      }
    } catch (e) {
      log('warn', 'không kiểm tra được hội thoại — bỏ qua', {
        agent: s.cfg.employeeCode,
        task: label,
        error: errText(e),
      });
      return null;
    }
    const id = this.store.enqueue(
      s.cfg.employeeCode,
      lightKey(s.cfg.employeeCode, w.conversation_id),
      label,
      '',
      'chat',
    );
    log('info', id ? 'xếp hàng tin nhắc' : 'hội thoại đã có job đang chờ / chạy — gộp', {
      agent: s.cfg.employeeCode,
      task: label,
      job: id,
    });
    return id;
  }

  /** Hỏi lại OfficeHub rồi xếp hàng. Trả id job (null = bỏ qua / đã có job đang chờ cho việc này). */
  async accept(s: AgentState, w: WakeData): Promise<number | null> {
    if (!s.enabled || !s.employeeId) {
      log('warn', 'agent đang tắt — bỏ qua', { agent: s.cfg.employeeCode, task: w.task_code, problem: s.problem });
      return null;
    }
    try {
      const c = checkTask(await s.hub.getTask(w.task_id), w, s.employeeId);
      if (!c.ok) {
        log('info', 'bỏ qua việc', { agent: s.cfg.employeeCode, task: w.task_code, reason: c.reason });
        return null;
      }
    } catch (e) {
      log('warn', 'không kiểm tra được việc — bỏ qua', {
        agent: s.cfg.employeeCode,
        task: w.task_code,
        error: errText(e),
      });
      return null;
    }
    const id = this.store.enqueue(s.cfg.employeeCode, w.task_id, w.task_code, w.project_id);
    log('info', id ? 'xếp hàng việc' : 'việc đã có job đang chờ / chạy', {
      agent: s.cfg.employeeCode,
      task: w.task_code,
      job: id,
    });
    return id;
  }

  // ---------------- Scheduler + Executor ----------------

  /** Mỗi 2 giây lấy job kế nếu còn slot (tổng ≤ max_parallel, mỗi agent 1). */
  async schedule() {
    while (!this.abort.signal.aborted) {
      const enabled = [...this.agents.values()].filter((a) => a.enabled).map((a) => a.cfg.employeeCode);
      const job = this.store.claimNext(this.config.maxParallel, enabled);
      if (job) void this.process(job);
      else await Bun.sleep(2000);
    }
  }

  /** Thư mục chạy của phiên không có repo (mode none, chat, họp) — xem {@link workDir}. */
  workDir(agent: string, name: string) {
    return workDir(this.config.dataDir, agent, name);
  }

  private jobDir(job: Pick<Job, 'id'>) {
    return jobDir(this.config.dataDir, job.id);
  }

  async process(job: Job): Promise<void> {
    const s = this.agents.get(job.agent)!;
    const ctl = new AbortController();
    this.running.set(job.id, ctl);
    try {
      // Agent đang họp → việc / chat chờ (kiểm tra trước khi ghi log bắt đầu: job hoãn được hỏi lại mỗi 30 giây).
      if (job.kind !== 'meeting' && (await this.heldByMeeting(s, job))) return;
      log('info', 'bắt đầu job', { job: job.id, agent: job.agent, task: job.task_code });
      if (job.kind === 'meeting') await this.processMeeting(s, job, ctl.signal);
      else if (job.kind === 'chat') await this.processChat(s, job, ctl.signal);
      else await this.processTask(s, job, ctl.signal);
    } catch (e) {
      if (e instanceof RunnerStopped) {
        this.store.requeue(job.id, 'runner dừng giữa phiên');
        log('warn', 'runner dừng giữa phiên — job về hàng đợi', { job: job.id, agent: job.agent, task: job.task_code });
        return;
      }
      // Lỗi sau khi đã ghi kết quả phiên (vd xếp lượt chat kế) → giữ kết quả + chi phí đã ghi, chỉ log
      if (this.store.getJob(job.id)?.status === 'running') this.store.finish(job.id, 'failed', { reason: errText(e) });
      log('error', 'job lỗi', { job: job.id, task: job.task_code, error: errText(e) });
    } finally {
      this.running.delete(job.id);
      for (const f of ['prompt.md', 'mcp.json']) rmSync(join(this.jobDir(job), f), { force: true }); // giữ output.log để tra lỗi
    }
  }

  /**
   * Chạy CLI của agent cho một job: ghi prompt + cấu hình MCP vào thư mục tạm của job, env riêng (không kế thừa env runner), log từng thao tác.
   * `presence` = có báo thao tác lên văn phòng 3D không; `noBuiltinTools` = chỉ tool MCP.
   * `label` = tên phiên người xem trực tiếp thấy ("MÃ · tên việc"; chat / họp: nhãn chung, không có nội dung tin).
   */
  private async runSession(
    s: AgentState,
    job: Job,
    signal: AbortSignal,
    o: {
      cwd: string;
      prompt: string;
      resume?: string;
      exec?: ExecutorConfig;
      noBuiltinTools?: boolean;
      presence: boolean;
      label: string;
    },
  ): Promise<RunOutcome> {
    const jobDir = this.jobDir(job),
      exec = o.exec ?? s.cfg.executor;
    mkdirSync(jobDir, { recursive: true });
    const promptFile = join(jobDir, 'prompt.md'),
      mcpFile = join(jobDir, 'mcp.json');
    writeFileSync(promptFile, o.prompt, { mode: 0o600 });
    // TEST-143: hồ sơ tool theo loại job (việc / chat / họp)
    writeFileSync(mcpFile, JSON.stringify(mcpConfig(this.config.mcpUrl, job.kind ?? 'task'), null, 2), { mode: 0o600 });
    const env = {
      ...this.envFor(s.cfg),
      OFFICEHUB_TOKEN: s.cfg.token,
      [AGENT_ENV]: job.agent,
      [TASK_ENV]: job.task_code,
    };
    const onActivity = (action: string) => {
      log('info', 'agent đang làm', { job: job.id, agent: job.agent, task: job.task_code, action });
      if (o.presence) s.presence.activity(action);
      // activity.log: bản đọc được của phiên (output.log là stream-json thô) — mỗi thao tác một dòng kèm giờ.
      try {
        appendFileSync(join(jobDir, 'activity.log'), redact(`${new Date().toTimeString().slice(0, 8)}  ${action}\n`));
      } catch {
        /* không chặn job vì log */
      }
    };
    // Dòng đầu job ghi model: adapter claude tự báo từ sự kiện system/init; adapter khác chỉ biết model cấu hình.
    if (!adapters[exec.kind]?.activity)
      onActivity(`Model ${exec.model ? `${exec.model} (cấu hình)` : 'mặc định của CLI'}`);
    // Người đứng gần bot trong 3D xem trực tiếp: bắt đầu phiên → từng thao tác → kết thúc phiên. Bộ gửi chạy ở nền: job KHÔNG chờ nó
    // và lỗi của nó không tới được đây (lỗi 2026-11-14: chờ gửi nốt ở cuối job làm runner treo, không ghi kết quả / bình luận chi phí).
    s.activity.push(sessionStart(o.label, exec.model));
    let out: RunOutcome | undefined;
    try {
      out = await runExecutor(
        {
          cwd: o.cwd,
          jobDir,
          promptFile,
          prompt: o.prompt,
          mcpConfigFile: mcpFile,
          resumeSessionId: o.resume,
          exec,
          noBuiltinTools: o.noBuiltinTools,
          systemPrompt: o.noBuiltinTools ? MCP_SYSTEM_PROMPT : undefined,
          onActivity,
          onEvent: s.activity.active ? (e) => s.activity.push(e) : undefined,
        },
        env,
        signal,
      );
    } finally {
      const failed = !out || out.exitCode !== 0 || out.timedOut;
      s.activity.push(sessionEnd(out ? { ...out, isError: out.isError || failed } : { isError: true }, o.label));
      s.activity.flushNow();
    }
    // Runner bị dừng (stop() huỷ phiên): không ghi kết quả / bình luận "phiên lỗi" — process() đưa job về hàng đợi.
    if (signal.aborted) throw new RunnerStopped();
    if (out.model && !out.modelFromConfig && !modelMatches(exec.model, out.model))
      log('warn', 'model thật khác cấu hình', {
        job: job.id,
        agent: job.agent,
        task: job.task_code,
        model: out.model,
        configured: exec.model,
      });
    return out;
  }

  /**
   * Nối phiên CLI cũ của khoá job không (TEST-142) — chỉ khi RẺ hơn mở phiên mới:
   * cùng agent, lần chạy trước cách ≤ {@link RESUME_MAX_GAP_MIN} phút (cache prompt còn sống; xa hơn thì nối phiên = ghi lại cả transcript cũ
   * vào cache, đắt hơn phiên mới đọc lại từ OfficeHub), transcript còn ở máy (adapter có `hasSession`), chưa nối quá `maxResumes` lần liên tiếp.
   * `task_sessions` mất (máy mới) → phiên mới, không lỗi.
   */
  private async resumeFor(s: AgentState, job: Job, cwd: string, maxResumes?: number): Promise<string | undefined> {
    const prev = this.store.session(job.task_id);
    const why = (reason: string) => {
      log('info', `mở phiên mới (${reason})`, { job: job.id, agent: job.agent, task: job.task_code });
      return undefined;
    };
    const adapter = adapters[s.cfg.executor.kind];
    if (!adapter?.caps.resume) return undefined;
    // TEST-144: máy mới / mất runner.db → không có dòng phiên; thử bản trên cloud của đúng khoá này (khôi phục lười, chỉ khi còn trong ngưỡng)
    if (!prev?.session_id || prev.agent !== job.agent) return prev ? undefined : this.restoreFromCloud(s, job, cwd);
    const gapMin = (Date.now() - Date.parse(prev.updated_at)) / 60_000;
    if (!(gapMin <= RESUME_MAX_GAP_MIN))
      return why(`lần chạy trước cách ${Math.round(gapMin)} phút > ${RESUME_MAX_GAP_MIN}`);
    if (maxResumes !== undefined && (prev.resumes ?? 0) >= maxResumes)
      return why(`đã nối ${prev.resumes} lần liên tiếp`);
    if (adapter.hasSession && !adapter.hasSession(this.envFor(s.cfg).HOME!, cwd, prev.session_id))
      return (
        (await this.restoreFromCloud(s, job, cwd)) ?? why('không còn transcript ở máy, cloud không có bản dùng được')
      );
    return prev.session_id;
  }

  /** Khôi phục transcript của khoá job từ cloud (TEST-144); lỗi không chặn job — trả undefined = phiên mới. */
  private async restoreFromCloud(s: AgentState, job: Job, cwd: string): Promise<string | undefined> {
    if (!s.transcripts) return undefined;
    try {
      return await s.transcripts.restore(job.task_id, cwd);
    } catch (e) {
      log('warn', 'khôi phục transcript từ cloud lỗi — mở phiên mới', {
        job: job.id,
        agent: job.agent,
        error: errText(e),
      });
      return undefined;
    }
  }

  /** Sau phiên: đưa transcript vào hàng chờ gửi lên cloud (kèm bản bàn giao = câu cuối của agent) và gửi ở nền (TEST-144). */
  private queueTranscript(s: AgentState, job: Job, out: RunOutcome) {
    if (!s.transcripts || !out.sessionId) return;
    this.store.markTranscript(job.task_id, job.kind ?? 'task', out.summary?.trim() ? out.summary.trim() : null);
    void s.transcripts.flush().catch((e) => log('warn', 'gửi transcript lỗi', { agent: job.agent, error: errText(e) }));
  }

  /**
   * Ghi kết quả phiên vào hàng đợi (trạng thái, chi phí, token, model) rồi gửi mức dùng AI lên OfficeHub ở nền (TEST-135 — lỗi không ảnh hưởng job,
   * phiên chưa gửi được gửi lại theo nhịp {@link USAGE_RETRY_MS}). Trả `ok`.
   */
  private finishJob(s: AgentState, job: Job, out: RunOutcome, f: { note?: string; prUrl?: string } = {}): boolean {
    const ok = out.exitCode === 0 && !out.timedOut && !out.isError;
    this.store.finish(job.id, ok ? 'done' : 'failed', {
      reason: out.timedOut
        ? 'hết giờ'
        : out.isError
          ? `CLI báo lỗi (${out.errorKind ?? out.exitCode})`
          : out.exitCode !== 0
            ? `mã thoát ${out.exitCode}`
            : f.note || null,
      session_id: out.sessionId ?? null,
      cost_usd: out.costUsd ?? null,
      input_tokens: out.inputTokens ?? null,
      output_tokens: out.outputTokens ?? null,
      turns: out.turns ?? null,
      pr_url: f.prUrl ?? null,
      model: out.model ? out.model + (out.modelFromConfig ? ' (cấu hình)' : '') : null,
      model_usage: out.modelUsage ? JSON.stringify(out.modelUsage) : null,
      cache_read_tokens: out.cacheReadTokens ?? null,
      cache_write_tokens: out.cacheWriteTokens ?? null,
      executor: s.cfg.executor.kind,
      cli_ran: 1,
    });
    void s.usage.flush().catch((e) => log('warn', 'gửi mức dùng AI lỗi', { agent: job.agent, error: errText(e) }));
    log(ok ? 'info' : 'warn', 'xong job', {
      job: job.id,
      task: job.task_code,
      ok,
      model: out.model,
      pr: f.prUrl,
      cost: out.costUsd,
      sec: out.durationSec,
    });
    return ok;
  }

  /**
   * Job chat (TEST-81): kiểm tra lại hội thoại → chạy CLI trong thư mục trống riêng của hội thoại, CHỈ tool MCP (tin nhắn là nội dung người khác
   * viết) → agent tự đọc / trả lời / đánh dấu đã đọc. Dùng `executor` của agent như job việc (model, giờ, ngân sách). Nối phiên theo hội thoại
   * khi lần trước cách ≤ {@link RESUME_MAX_GAP_MIN} phút (TEST-142). Không bình luận vào việc, không báo trạng thái 3D; chi phí vẫn vào `report`.
   */
  private async processChat(s: AgentState, job: Job, signal: AbortSignal): Promise<void> {
    const conv = lightId(job);
    const c = checkChat(await s.hub.listChats(), conv);
    if (!c.ok) {
      this.store.finish(job.id, 'skipped', { reason: c.reason });
      log('info', 'bỏ job', { job: job.id, reason: c.reason });
      return;
    }
    const cwd = this.workDir(job.agent, `chat-${conv}`);
    mkdirSync(cwd, { recursive: true });
    const resume = await this.resumeFor(s, job, cwd);
    const out = await this.runSession(s, job, signal, {
      cwd,
      prompt: chatPrompt(job.agent, c.value.conversation, !!resume),
      resume,
      exec: lightExecutor(s.cfg.executor),
      noBuiltinTools: true,
      presence: false,
      label: 'Trả lời tin nhắn',
    });
    this.store.saveSession(job.task_id, job.agent, out.sessionId ?? null, '', cwd, !!resume);
    this.queueTranscript(s, job, out);
    this.finishJob(s, job, out);
    // Có tin nhắc mới tới giữa phiên → kiểm tra lại (đã đọc hết thì tự bỏ) và chạy thêm một lượt.
    if (this.store.getJob(job.id)?.rerun)
      await this.acceptChat(s, { employee_code: job.agent, conversation_id: conv, message_id: '' });
  }

  /**
   * Job họp (TEST-84) = MỘT lượt nói: kiểm tra lại (đúng phiên, còn giữ lượt) → chạy CLI trong thư mục trống riêng của cuộc họp, CHỉ tool MCP,
   * tối đa {@link MEETING_TURN_MAX_MIN} phút (server tự chuyển lượt sau 3 phút) → agent tự `speak_in_meeting` / `pass_turn`.
   * Nối phiên theo cuộc họp (agent nhớ diễn biến, không đọc lại từ đầu). Không bình luận vào việc, không báo trạng thái 3D (bot đang được giữ
   * ở phòng họp); chi phí vào `report`. Sau phiên mà agent VẪN giữ lượt (CLI lỗi / hết giờ / không nói) → runner bỏ lượt thay.
   */
  private async processMeeting(s: AgentState, job: Job, signal: AbortSignal): Promise<void> {
    const session = lightId(job);
    const c = checkMeeting(await s.hub.myMeeting(), session);
    if (!c.ok) {
      this.store.finish(job.id, 'skipped', { reason: c.reason });
      log('info', 'bỏ job', { job: job.id, reason: c.reason });
      return;
    }
    const cwd = this.workDir(job.agent, `meeting-${session}`);
    mkdirSync(cwd, { recursive: true });
    const resume = await this.resumeFor(s, job, cwd, MEETING_RESUME_MAX);
    const exec = {
      ...lightExecutor(s.cfg.executor),
      timeoutMin: Math.min(s.cfg.executor.timeoutMin, MEETING_TURN_MAX_MIN),
    };
    try {
      const out = await this.runSession(s, job, signal, {
        cwd,
        prompt: meetingPrompt(job.agent, session, !!resume),
        resume,
        exec,
        noBuiltinTools: true,
        presence: false,
        label: 'Phát biểu trong cuộc họp',
      });
      this.store.saveSession(job.task_id, job.agent, out.sessionId ?? null, '', cwd, !!resume);
      this.queueTranscript(s, job, out);
      this.finishJob(s, job, out);
    } finally {
      await this.afterMeetingTurn(s, job).catch((e) =>
        log('warn', 'không kiểm tra được lượt họp sau phiên', { job: job.id, agent: job.agent, error: errText(e) }),
      );
    }
  }

  /**
   * Sau một lượt họp: agent còn giữ lượt của phiên đó không?
   * - Có tin meeting_turn mới tới giữa phiên (`rerun`) → đó là lượt MỚI → xếp thêm một job.
   * - Không → agent chưa dùng lượt vừa rồi → bỏ lượt thay, cuộc họp đi tiếp ngay thay vì chờ hết hạn nói.
   */
  private async afterMeetingTurn(s: AgentState, job: Job): Promise<void> {
    const session = lightId(job);
    if (!checkMeeting(await s.hub.myMeeting(), session).ok) return;
    const done = this.store.getJob(job.id);
    if (done?.rerun && done.status !== 'running') {
      await this.acceptMeeting(s, { employee_code: job.agent, session_id: session, conversation_id: '' });
      return;
    }
    await s.hub.passTurn();
    log('warn', 'agent không dùng lượt họp — runner bỏ lượt thay', {
      job: job.id,
      agent: job.agent,
      task: job.task_code,
    });
  }

  /** Job việc: kiểm tra lại việc → chuẩn bị nơi làm (worktree / in_place / none) → chạy CLI → push + PR (worktree) / push nhánh đang checkout (in_place) → bình luận kết quả. */
  private async processTask(s: AgentState, job: Job, signal: AbortSignal): Promise<void> {
    const w: WakeData = {
      employee_code: job.agent,
      project_id: job.project_id,
      task_id: job.task_id,
      task_code: job.task_code,
    };
    // Văn phòng 3D (TEST-121): job hỏng → `error` kèm loại lỗi ngắn (giữ tới job kế), còn lại → rảnh.
    let task = job.task_code,
      failure: string | undefined;
    try {
      const detail = await s.hub.getTask(job.task_id);
      const c = checkTask(detail, w, s.employeeId!);
      if (!c.ok) {
        this.store.finish(job.id, 'skipped', { reason: c.reason });
        log('info', 'bỏ job', { job: job.id, reason: c.reason });
        return;
      }
      s.presence.working(job.task_code, c.value.title);
      if (c.value.title?.trim()) task = `${job.task_code} · ${c.value.title.trim()}`;

      const mode = s.cfg.workspace.mode;
      const git = this.gitFor(s.cfg);
      let ws: { path: string; branch: string; reused: boolean; existing?: 'local' | 'origin' },
        startHead = '';
      if (mode === 'none') {
        // Agent nghiệp vụ: không git. Thư mục trống cố định theo việc (nối phiên khi việc bị trả về).
        ws = { path: this.workDir(job.agent, job.task_code.toUpperCase()), branch: '', reused: false };
        mkdirSync(ws.path, { recursive: true });
      } else {
        const onMain = await mainBranchWarning(git, s.cfg, this.config.baseBranch);
        if (onMain)
          log('warn', 'repo đang ở main / master', {
            job: job.id,
            agent: job.agent,
            task: job.task_code,
            message: onMain,
          });
        if (mode === 'in_place') {
          // in_place không dùng hook → gỡ hook của runner nếu còn (hook của người dùng giữ nguyên).
          const removed = await removeHooks(git, s.cfg.repo);
          if (removed.length)
            log('info', 'đã gỡ hook của runner (in_place không dùng)', {
              job: job.id,
              agent: job.agent,
              hooks: removed,
            });
        } else {
          // worktree: hook có thể bị xoá sau lúc khởi động → trước mỗi job kiểm tra, thiếu thì tạo lại (hook khác của người dùng: không ghi đè, chỉ cảnh báo).
          for (const m of await installHooks(git, s.cfg.repo, this.config.baseBranch))
            log('warn', 'hook git', { job: job.id, agent: job.agent, message: m });
        }
        try {
          if (mode === 'in_place') {
            const r = await prepareInPlace(git, s.cfg.repo, this.config.baseBranch, s.cfg.workspace.allowBaseBranch);
            ws = { path: r.path, branch: r.branch, reused: false };
            startHead = r.head;
          } else
            ws = await prepareWorktree(
              git,
              s.cfg.repo,
              this.config.worktreesDir,
              job.agent,
              job.task_code,
              this.config.baseBranch,
            );
        } catch (e) {
          if (!(e instanceof WorkspaceRefused)) throw e;
          // Workspace chưa sẵn sàng (đang bẩn / sai nhánh…) — không chạy agent, báo lại trong việc để người xử lý rồi giao lại.
          this.store.finish(job.id, 'skipped', { reason: e.message });
          failure = 'Không chạy được';
          await s.hub
            .comment(job.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy: ${e.message}`)
            .catch(() => undefined);
          log('warn', 'bỏ job — workspace chưa sẵn sàng', { job: job.id, task: job.task_code, reason: e.message });
          return;
        }
      }
      const prev = this.store.session(job.task_id);
      const resume = await this.resumeFor(s, job, ws.path);
      // Phiên mới nhưng việc đã từng làm (worktree / nhánh local hoặc origin / phiên cũ) → prompt bảo đọc Bàn giao trước
      const continued = !resume && (ws.reused || !!ws.existing || !!prev);
      if (ws.existing === 'origin')
        log('info', 'máy chưa có nhánh việc — lấy lại từ origin để làm tiếp', {
          job: job.id,
          agent: job.agent,
          branch: ws.branch,
        });
      const prompt = buildPrompt(w, { mode, branch: ws.branch, resumed: !!resume, continued });
      const out = await this.runSession(s, job, signal, {
        cwd: ws.path,
        prompt,
        resume,
        noBuiltinTools: mode === 'none',
        presence: true,
        label: `${job.task_code} · ${c.value.title}`,
      });
      this.store.saveSession(job.task_id, job.agent, out.sessionId ?? null, ws.branch, ws.path, !!resume);
      this.queueTranscript(s, job, out);

      let prUrl: string | undefined,
        note = '';
      if (mode === 'none') {
        // Không có gì để push: kết quả nằm trên OfficeHub (agent tự bình luận), runner chỉ báo thời gian / chi phí.
      } else if (mode === 'in_place') {
        // in_place: commit trong workspace rồi runner push thẳng nhánh đang checkout lên origin — KHÔNG PR.
        // Không push khi agent chạm agent-runner/ hoặc tự đổi nhánh (người thật xem lại trên máy).
        const ch = await inPlaceChanges(git, ws.path, startHead, ws.branch);
        if (ch.ahead > 0) {
          let pushed = 'CHƯA push';
          if (!ch.touchesProtected && !ch.branchChanged) {
            try {
              await pushInPlace(git, ws.path, ws.branch);
              pushed = 'đã push lên origin';
            } catch (e) {
              pushed = `⚠ CHƯA push — git push lỗi: ${errText(e).slice(0, 300)}`;
              failure = 'Không push được';
            }
          } else failure = 'Không push được';
          note = `${ch.ahead} commit mới trên nhánh \`${ch.branchNow || ws.branch}\` (${pushed}): ${ch.commits
            .slice(0, 5)
            .map((c) => `\`${c}\``)
            .join(', ')}${ch.ahead > 5 ? ', …' : ''}`;
        } else note = 'Phiên kết thúc, không có commit mới.';
        if (ch.touchesProtected)
          note +=
            ' ⚠ Có thay đổi trong `agent-runner/` — runner KHÔNG push; người thật xem lại / bỏ commit đó rồi tự push.';
        if (ch.branchChanged)
          note += ` ⚠ Agent đã đổi nhánh (${ws.branch} → ${ch.branchNow || 'detached HEAD'}) trái quy tắc — runner KHÔNG push, kiểm tra repo.`;
        if (ch.dirty) note += ' Còn thay đổi chưa commit trong workspace.';
      } else {
        const ch = await branchChanges(git, ws.path, this.config.baseBranch);
        if (ch.touchesProtected) {
          note =
            '⚠ Nhánh có thay đổi trong `agent-runner/` — runner KHÔNG push. Người thật kiểm tra worktree trên máy agent.';
          failure = 'Không push được';
        } else if (ch.ahead > 0) {
          try {
            prUrl = await publish(
              git,
              ws.path,
              ws.branch,
              this.config.baseBranch,
              `${job.task_code}: ${c.value.title}`.slice(0, 200),
              `Việc OfficeHub **${job.task_code}** — agent ${job.agent}, tạo tự động bởi agent-runner (TEST-44). Người thật review trước khi merge.`,
            );
          } catch (e) {
            note = `⚠ Không push / tạo được PR: ${errText(e)}`;
            failure = errText(e).startsWith('git push lỗi') ? 'Không push được' : 'Không tạo được PR';
          }
        } else note = 'Phiên kết thúc, nhánh không có commit mới.';
        if (ch.dirty) note += (note ? ' ' : '') + 'Còn thay đổi chưa commit trong worktree.';
      }

      const ok = out.exitCode === 0 && !out.timedOut && !out.isError;
      if (!ok) failure = presenceFailure(out);
      await s.hub.comment(job.task_id, resultComment(job, out, prUrl, note, ok, s.cfg.executor.model));
      this.finishJob(s, job, out, { note, prUrl });
    } catch (e) {
      if (!(e instanceof RunnerStopped)) failure = 'Runner lỗi'; // process() ghi failed + log
      throw e;
    } finally {
      if (failure) s.presence.error(failure, { task, taskId: job.task_id, projectId: job.project_id });
      else s.presence.idle();
    }
  }

  async start(modelCheck = true) {
    const recovered = this.store.recoverRunning();
    if (recovered) log('warn', 'đưa lại job đang chạy dở vào hàng đợi', { count: recovered });
    for (const f of await this.checkAgents({ modelCheck })) log(findingLogLevel(f), formatFinding(f));
    const enabled = [...this.agents.values()].filter((a) => a.enabled);
    if (enabled.length === 0) throw new Error('Không agent nào chạy được — xem các dòng ✘ ở trên (chạy `doctor`)');
    for (const s of enabled) {
      s.presence.start();
      void this.listen(s);
    }
    // Mức dùng AI (TEST-135): gửi phiên còn tồn từ lần chạy trước, rồi gửi lại theo nhịp (máy chủ tạm lỗi / chưa có bản mới)
    const flushUsage = () => {
      for (const s of this.agents.values()) {
        void s.usage.flush().catch(() => undefined);
        void s.transcripts?.flush().catch(() => undefined); // TEST-144: transcript chờ gửi (máy chủ tạm lỗi / chưa có bản mới)
      }
    };
    flushUsage();
    this.usageTimer = setInterval(flushUsage, USAGE_RETRY_MS);
    await this.schedule();
  }

  stop() {
    this.abort.abort();
    clearInterval(this.usageTimer);
    for (const s of this.agents.values()) {
      s.presence.stop();
      s.activity.stop();
    }
    for (const c of this.running.values()) c.abort();
  }
}

/** Loại lỗi ngắn của phiên hỏng cho bong bóng 3D (TEST-121) — không lộ stderr / lời agent. */
export function presenceFailure(out: Pick<RunOutcome, 'exitCode' | 'timedOut' | 'isError'>): string {
  return out.timedOut ? 'Hết giờ' : out.isError ? 'CLI báo lỗi' : `Mã thoát ${out.exitCode}`;
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
  const parts = [
    `**🤖 agent-runner** (${job.agent}) — ${ok ? 'phiên kết thúc' : out.timedOut ? 'HẾT GIỜ, đã dừng phiên' : 'phiên lỗi'}`,
    prUrl ? `- PR: ${prUrl}` : null,
    `- Thời gian: ${Math.round(out.durationSec / 60)} phút${out.turns ? ` · ${out.turns} lượt` : ''}`,
    `- Model: ${modelLine(out, configuredModel)}`,
    out.costUsd !== undefined
      ? `- Chi phí: $${out.costUsd.toFixed(2)}${out.inputTokens ? ` · ${out.inputTokens.toLocaleString('en')} token vào / ${(out.outputTokens ?? 0).toLocaleString('en')} ra` : ''}`
      : null,
    note ? `- ${note}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

/** Họp: nối phiên tối đa ngần này lượt liên tiếp rồi mở phiên mới (transcript dài dần, mỗi lượt đọc lại cả cuộc họp) — TEST-142. */
export const MEETING_RESUME_MAX = 8;

/** Thời gian tối đa của một lượt họp (phút) — dưới hạn nói 3 phút của OfficeHub (`AgentMeetingTurnRules.TurnTimeout`) để runner kịp bỏ lượt thay. */
export const MEETING_TURN_MAX_MIN = 2.5;

/** Agent đang họp: job việc / chat hoãn từng nhịp này (giây) rồi kiểm tra lại. */
export const MEETING_HOLD_SEC = 30;

/**
 * Khoá của job chat / họp (`jobs.task_id`, cũng là khoá nối phiên): RIÊNG từng agent — nhiều bot cùng một hội thoại / cuộc họp mỗi bot một job,
 * một phiên CLI (job việc khoá theo id việc vì việc chỉ có một người làm).
 */
export const lightKey = (agent: string, id: string) => `${agent}:${id}`;
/** Id hội thoại / phiên họp của job chat / họp (bỏ tiền tố agent của {@link lightKey}). */
export const lightId = (job: Pick<Job, 'task_id'>) => job.task_id.slice(job.task_id.indexOf(':') + 1);

/** Nhãn job họp trong log / cột task_code. */
export const meetingLabel = (sessionId: string) => `meeting:${sessionId.slice(0, 8)}`;

/** Nhãn job chat trong log / cột task_code. */
export const chatLabel = (conversationId: string) => `chat:${conversationId.slice(0, 8)}`;
