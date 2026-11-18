import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfig, RunnerConfig } from './config';
import type { AgentState } from './core/agent';
import { agentEnv, agentHome } from './core/env';
import { jobDir, workDir } from './core/paths';
import { RunnerStopped, Sessions } from './core/session';
import { type DoctorContext, type DoctorOptions, diagnoseAgent, gitUnavailable } from './doctor/agent';
import { type Finding, findingLogLevel, formatFinding } from './doctor/finding';
import { adapters } from './executor/run';
import { ActivitySender } from './hub/activity';
import { OfficeHubClient } from './hub/client';
import type { MeetingState } from './hub/types';
import { PresenceReporter } from './hub/presence';
import { TranscriptReporter } from './hub/transcript';
import { sourceHost, USAGE_RETRY_MS, UsageReporter } from './hub/usage';
import { createJobHandlers, type JobHandler, type JobHandlers } from './jobs';
import { errText, log, registerSecret } from './log';
import {
  MEETING_HOLD_SEC,
  SCHEDULE_POLL_MS,
  STARTUP_CATCHUP_MAX,
  STARTUP_RECENT_JOB_MIN,
  TELEGRAM_RETRY_SEC,
} from './policy';
import type { Job, Store } from './store';
import { TelegramClient, type TgMessage } from './telegram';
import { parseWake, pickStartupTasks, type Wake } from './validator';
import { Git } from './workspace';

export { RunnerStopped } from './core/session';

/**
 * Bộ điều phối: Listener (Telegram) → nhận tin (validator + handler của loại job hỏi lại OfficeHub) → Store (hàng đợi + khoá job) →
 * Scheduler → handler chạy job (workspace → phiên CLI → đẩy sản phẩm + bình luận). Lớp này chỉ nối dây: mỗi loại job ở `jobs/`,
 * mỗi mode workspace ở `workspace/`, vòng đời phiên CLI ở `core/session.ts`, kiểm tra agent ở `doctor/`.
 */
export class Runner {
  readonly agents = new Map<string, AgentState>();
  private readonly abort = new AbortController();
  private readonly running = new Map<number, AbortController>();
  private usageTimer?: ReturnType<typeof setInterval>;
  /** Git của runner (env của runner); thao tác cho agent dùng `gitFor(agent)` (HOME / PATH của agent). */
  readonly git: Git;
  private readonly handlers: JobHandlers;

  constructor(
    readonly config: RunnerConfig,
    readonly store: Store,
  ) {
    this.git = new Git(config.gitBin);
    this.handlers = createJobHandlers({
      config,
      store,
      sessions: new Sessions(config, store, this.git),
      gitFor: (agent) => this.gitFor(agent),
      accept: (s, wake) => this.accept(s, wake),
    });
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
        transcripts: this.transcriptsOf(a),
      });
    }
  }

  /** Bộ gửi transcript lên cloud — chỉ khi adapter của CLI biết transcript nằm ở đâu. */
  private transcriptsOf(a: AgentConfig): TranscriptReporter | undefined {
    const locate = adapters[a.executor.kind].transcriptFile;
    if (!locate) return undefined;
    const home = agentHome(a);
    return new TranscriptReporter(this.config.mcpUrl, a.token, a.employeeCode, this.store, (cwd, sessionId) =>
      locate(home, cwd, sessionId),
    );
  }

  // ---------------- Kiểm tra agent ----------------

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

  /** Thư mục chạy của phiên không có repo (mode none, chat, họp) — xem {@link workDir}. */
  workDir(agent: string, name: string) {
    return workDir(this.config.dataDir, agent, name);
  }

  // ---------------- Listener + nhận tin ----------------

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
        const wait = ((e as { retryAfter?: number }).retryAfter ?? TELEGRAM_RETRY_SEC) * 1000;
        log('warn', 'getUpdates lỗi', { agent: s.cfg.employeeCode, error: errText(e), retryMs: wait });
        await Bun.sleep(wait);
      }
    }
  }

  /** Một tin trong nhóm Telegram: không phải tin đánh thức hợp lệ của agent này → bỏ qua (chỉ log); hợp lệ → {@link accept}. */
  async onMessage(s: AgentState, msg: TgMessage): Promise<number | null> {
    const wake = parseWake(msg, { groupChatId: this.config.groupChatId, employeeCode: s.cfg.employeeCode });
    if (!wake.ok) {
      log('info', 'bỏ qua tin Telegram', { agent: s.cfg.employeeCode, reason: wake.reason });
      return null;
    }
    return this.accept(s, wake.value);
  }

  /**
   * Nhận một tin đánh thức: handler của loại job hỏi lại OfficeHub bằng token của agent (lớp bảo vệ thật) rồi xếp hàng.
   * Trả id job; null = bỏ qua, hoặc khoá đã có job đang chờ / chạy (job chat / họp đang chạy được đánh dấu chạy thêm một lượt).
   */
  async accept(s: AgentState, wake: Wake): Promise<number | null> {
    const handler = this.handlerOf(wake.kind);
    const agent = s.cfg.employeeCode;
    const label = handler.label(wake);
    const fields = { agent, task: label };
    if (!s.enabled || !s.employeeId) {
      log('warn', 'agent đang tắt — bỏ qua', { ...fields, problem: s.problem });
      return null;
    }
    try {
      const admission = await handler.admit(s, wake);
      if (!admission.ok) {
        if (admission.warning) log('warn', admission.warning, { ...fields, reason: admission.reason });
        else log('info', handler.text.skipped, { ...fields, reason: admission.reason });
        return null;
      }
    } catch (e) {
      log('warn', handler.text.checkFailed, { ...fields, error: errText(e) });
      return null;
    }
    const id = this.store.enqueue(agent, handler.key(wake, agent), label, handler.projectId(wake), handler.kind);
    log('info', id ? handler.text.queued : handler.text.merged, { ...fields, job: id });
    return id;
  }

  /**
   * Bắt bù lúc khởi động (TEST-158): hỏi OfficeHub các việc đang giao cho agent rồi xếp hàng những việc cần làm ngay, không chờ tin đánh thức
   * (việc giao trước khi runner chạy, runner tắt quá lâu, tin Telegram gửi lỗi). Lọc bằng {@link pickStartupTasks} — bỏ việc bot đã báo đang
   * chờ người; mỗi việc còn lại đi qua {@link accept} như một tin đánh thức (hỏi lại `get_task`, khoá theo id việc → trùng job dở / tin
   * Telegram tồn thì gộp). Tối đa {@link STARTUP_CATCHUP_MAX} việc; việc có job vừa kết thúc trong {@link STARTUP_RECENT_JOB_MIN} phút thì bỏ.
   * @returns số việc đã xếp hàng; null = không bắt bù được (không hỏi được OfficeHub / bản cũ) — chỉ log, runner vẫn chạy.
   */
  async catchUp(s: AgentState): Promise<number | null> {
    const agent = s.cfg.employeeCode;
    let list: unknown;
    try {
      list = await s.hub.myTasks();
    } catch (e) {
      log('warn', 'bắt bù lúc khởi động: không hỏi được việc của agent', { agent, error: errText(e) });
      return null;
    }
    const picked = pickStartupTasks(list);
    if (!picked.ok) {
      log('warn', 'bắt bù lúc khởi động: bỏ qua', { agent, reason: picked.reason });
      return null;
    }
    const { tasks, total, awaitingHuman, blocked, inactive, invalid } = picked.value;
    const recentSince = new Date(Date.now() - STARTUP_RECENT_JOB_MIN * 60_000).toISOString();
    let queued = 0;
    let recent = 0;
    let notQueued = 0;
    const batch = tasks.slice(0, STARTUP_CATCHUP_MAX);
    for (const t of batch) {
      if (this.abort.signal.aborted) break;
      if (this.store.finishedSince(t.id, recentSince)) {
        recent++;
        continue;
      }
      const wake: Wake = {
        kind: 'task',
        employee_code: agent,
        project_id: t.projectId,
        task_id: t.id,
        task_code: t.code,
      };
      if (await this.accept(s, wake)) queued++;
      else notQueued++;
    }
    log('info', 'bắt bù lúc khởi động', {
      agent,
      open: total,
      queued,
      // đã có job chờ / chạy cho việc đó, hoặc get_task không cho chạy (lý do ở dòng log ngay trên)
      notQueued,
      recent,
      awaitingHuman,
      blocked,
      inactive,
      invalid,
      overLimit: tasks.length - batch.length,
    });
    return queued;
  }

  /** Handler của một loại job. Registry định kiểu theo từng loại; ở đây chỉ cần giao diện chung. */
  private handlerOf(kind: Wake['kind']): JobHandler {
    return this.handlers[kind] as unknown as JobHandler;
  }

  // ---------------- Scheduler ----------------

  /** Lấy job kế nếu còn slot (tổng ≤ max_parallel, mỗi agent 1); không có thì chờ {@link SCHEDULE_POLL_MS}. */
  async schedule() {
    while (!this.abort.signal.aborted) {
      const enabled = [...this.agents.values()].filter((a) => a.enabled).map((a) => a.cfg.employeeCode);
      const job = this.store.claimNext(this.config.maxParallel, enabled);
      if (job) void this.process(job);
      else await Bun.sleep(SCHEDULE_POLL_MS);
    }
  }

  /**
   * Nhận rồi chạy NGAY một tin đánh thức, chờ xong cả các bộ gửi nền (lệnh `run`: chạy một lần rồi thoát). Vẫn hỏi lại OfficeHub như tin từ
   * Telegram. Không chạy được → `problem`; chạy được → `job` đã ghi kết quả.
   */
  async runNow(s: AgentState, wake: Wake): Promise<{ job?: Job; problem?: string }> {
    const agent = s.cfg.employeeCode;
    if (!(await this.accept(s, wake))) return { problem: 'Việc không chạy được (xem log ở trên)' };
    const job = this.store.claimNext(1, [agent]);
    if (!job) return { problem: 'Agent đang có job khác chạy' };
    await this.process(job);
    // Job đã ghi xong; tiến trình sắp thoát nên chờ các bộ gửi nền: sự kiện "kết thúc phiên" (tối đa 3 giây), mức dùng AI, transcript.
    // Gửi lỗi → phần đó còn trong hàng chờ, `start` / `usage push` gửi sau.
    await s.activity.drain();
    await s.usage.flush();
    await s.transcripts?.flush();
    return { job: this.store.getJob(job.id)! };
  }

  /** Chạy một job đã lấy khỏi hàng đợi bằng handler của loại job; lỗi ghi `failed`, runner dừng giữa phiên thì job về hàng đợi. */
  async process(job: Job): Promise<void> {
    const s = this.agents.get(job.agent)!;
    const handler = this.handlerOf(job.kind);
    const fields = { job: job.id, agent: job.agent, task: job.label };
    const ctl = new AbortController();
    this.running.set(job.id, ctl);
    try {
      // Agent đang họp → việc / chat chờ (kiểm tra trước khi ghi log bắt đầu: job hoãn được hỏi lại mỗi 30 giây).
      if (!handler.runsDuringMeeting && (await this.heldByMeeting(s, job))) return;
      log('info', 'bắt đầu job', fields);
      await handler.run(s, job, ctl.signal);
    } catch (e) {
      if (e instanceof RunnerStopped) {
        this.store.requeue(job.id, 'runner dừng giữa phiên');
        log('warn', 'runner dừng giữa phiên — job về hàng đợi', fields);
        return;
      }
      // Lỗi sau khi đã ghi kết quả phiên (vd xếp lượt chat kế) → giữ kết quả + chi phí đã ghi, chỉ log
      if (this.store.getJob(job.id)?.status === 'running') this.store.finish(job.id, 'failed', { reason: errText(e) });
      log('error', 'job lỗi', { job: job.id, task: job.label, error: errText(e) });
    } finally {
      this.running.delete(job.id);
      // prompt + cấu hình MCP chỉ sống trong lúc chạy; giữ output.log / activity.log để tra lỗi
      const dir = jobDir(this.config.dataDir, job.id);
      for (const f of ['prompt.md', 'mcp.json']) rmSync(join(dir, f), { force: true });
    }
  }

  /**
   * Agent đang dự cuộc họp agent → job việc / chat chưa chạy (mỗi agent một phiên; lượt nói có thể tới bất cứ lúc nào): hoãn
   * {@link MEETING_HOLD_SEC} giây rồi kiểm tra lại. Không hỏi được (tài khoản không phải bot, OfficeHub bản cũ) → coi như không họp.
   */
  private async heldByMeeting(s: AgentState, job: Job): Promise<boolean> {
    let meeting: MeetingState | undefined;
    try {
      meeting = await s.hub.myMeeting();
    } catch {
      return false;
    }
    if (!meeting?.inMeeting) return false;
    const reason = 'agent đang họp — chờ hết cuộc họp';
    if (job.reason !== reason) log('info', 'hoãn job', { job: job.id, agent: job.agent, task: job.label, reason });
    this.store.hold(job.id, new Date(Date.now() + MEETING_HOLD_SEC * 1000).toISOString(), reason);
    return true;
  }

  // ---------------- Vòng đời ----------------

  /** @param o `catchUp: false` (cờ `--no-catchup`) hoặc `runner.startup_catchup: false` → không bắt bù việc lúc khởi động. */
  async start(o: { modelCheck?: boolean; catchUp?: boolean } = {}) {
    const modelCheck = o.modelCheck ?? true;
    const recovered = this.store.recoverRunning();
    if (recovered) log('warn', 'đưa lại job đang chạy dở vào hàng đợi', { count: recovered });
    for (const f of await this.checkAgents({ modelCheck })) log(findingLogLevel(f), formatFinding(f));
    const enabled = [...this.agents.values()].filter((a) => a.enabled);
    if (enabled.length === 0) throw new Error('Không agent nào chạy được — xem các dòng ✘ ở trên (chạy `doctor`)');
    for (const s of enabled) {
      s.presence.start();
      void this.listen(s);
    }
    // Việc đang giao mà chưa có tin đánh thức (TEST-158) — chạy nền, không chặn listener / scheduler
    if (this.config.startupCatchup && o.catchUp !== false)
      for (const s of enabled)
        void this.catchUp(s).catch((e) =>
          log('warn', 'bắt bù lúc khởi động lỗi', { agent: s.cfg.employeeCode, error: errText(e) }),
        );
    // Mức dùng AI (TEST-135) + transcript (TEST-144): gửi phần còn tồn từ lần chạy trước, rồi gửi lại theo nhịp (máy chủ tạm lỗi / chưa có bản mới)
    const flushPending = () => {
      for (const s of this.agents.values()) {
        void s.usage.flush().catch(() => undefined);
        void s.transcripts?.flush().catch(() => undefined);
      }
    };
    flushPending();
    this.usageTimer = setInterval(flushPending, USAGE_RETRY_MS);
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
