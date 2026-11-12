import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isInside, readEnvFile, type AgentConfig, type RunnerConfig } from './config';
import { runExecutor, type RunOutcome } from './executor/run';
import { errText, log, registerSecret } from './log';
import { OfficeHubClient } from './officehub';
import { buildPrompt, mcpConfig } from './prompt';
import { Store, type Job } from './store';
import { TelegramClient, type TgMessage } from './telegram';
import { checkTask, parseWake, type WakeData } from './validator';
import { AGENT_ENV, Git, TASK_ENV, branchChanges, installHooks, prepareWorktree, publish, sh } from './workspace';

interface AgentState {
  cfg: AgentConfig;
  hub: OfficeHubClient;
  tg: TelegramClient;
  employeeId?: string;
  enabled: boolean;
  problem?: string;
}

/** Bộ điều phối: Listener (Telegram) → Validator → Store (hàng đợi + khoá task_id) → Workspace → Executor → Publisher (PR + bình luận). */
export class Runner {
  readonly agents = new Map<string, AgentState>();
  private readonly abort = new AbortController();
  private readonly running = new Map<number, AbortController>();
  /** Git của runner (env của runner); thao tác cho agent dùng `gitFor(agent)` (HOME / PATH của agent). */
  readonly git: Git;

  constructor(readonly config: RunnerConfig, readonly store: Store) {
    this.git = new Git(config.gitBin);
    for (const a of config.agents) {
      registerSecret(a.token);
      registerSecret(a.telegramToken);
      this.agents.set(a.employeeCode, {
        cfg: a, hub: new OfficeHubClient(config.mcpUrl, a.token), tg: new TelegramClient(config.telegramApiUrl, a.telegramToken), enabled: false,
      });
    }
  }

  /**
   * Kiểm tra từng agent (giống `doctor`): CLI chạy được, token đúng nhân viên, repo git có origin, hook pre-push, bot Telegram đúng username.
   * Agent lỗi bị tắt riêng, các agent khác vẫn chạy. Trả danh sách dòng kết quả.
   */
  async checkAgents(only?: string, telegram = true): Promise<string[]> {
    const out: string[] = [];
    // TEST-46: git sai đường dẫn → mọi agent tắt (không nhận việc).
    let gitError: string | null = null;
    try { out.push(`✔ git: ${await this.git.version()} (${this.config.gitBin})`); } catch (e) { gitError = errText(e); }
    for (const s of this.agents.values()) {
      if (only && s.cfg.employeeCode !== only) continue;
      const code = s.cfg.employeeCode;
      const fail = (m: string) => { s.enabled = false; s.problem = m; out.push(`✘ ${code}: ${m}`); };
      if (gitError) { fail(gitError); continue; }
      try {
        if (!existsSync(s.cfg.executor.bin)) { fail(`không thấy CLI ${s.cfg.executor.bin}`); continue; }
        const v = await sh([s.cfg.executor.bin, '--version'], '/', this.baseEnv(s.cfg));
        if (v.code !== 0) { fail(`${s.cfg.executor.bin} --version lỗi: ${v.err || v.out}`); continue; }
        out.push(`✔ ${code}: CLI ${v.out.split('\n')[0]}`);
        const me = await s.hub.me();
        if (me.code !== code) { fail(`token thuộc nhân viên ${me.code}, không phải ${code}`); continue; }
        s.employeeId = me.id;
        out.push(`✔ ${code}: token AI đúng nhân viên (${me.fullName})`);
        const git = this.gitFor(s.cfg);
        const origin = await git.run(s.cfg.repo, 'remote', 'get-url', 'origin');
        if (origin.code !== 0) { fail(`${s.cfg.repo} không phải git repo có remote origin`); continue; }
        const who = await git.identity(s.cfg.repo);
        if (!who) { fail(`chưa có git user.name / user.email (HOME ${this.baseEnv(s.cfg).HOME}) — commit sẽ lỗi; runner không tự đặt danh tính`); continue; }
        out.push(`✔ ${code}: commit đứng tên ${who.name} <${who.email}> (tài khoản git của máy), trailer Agent / Task`);
        for (const dir of [this.config.worktreesDir, this.config.dataDir].filter((d) => isInside(d, s.cfg.repo))) {
          const ignored = await git.run(s.cfg.repo, 'check-ignore', '-q', join(dir, 'x'));
          if (ignored.code !== 0) throw new Error(`${dir} nằm trong repo nhưng chưa có trong .gitignore — thêm vào trước khi chạy`);
        }
        const hookWarns = await installHooks(git, s.cfg.repo, this.config.baseBranch);
        for (const w of hookWarns) out.push(`⚠ ${code}: ${w}`);
        out.push(`✔ ${code}: repo ${s.cfg.repo}, hook pre-push (chặn main / force push / agent-runner/) + commit-msg (trailer) đã cài`);
        if (s.cfg.envFile && !existsSync(s.cfg.envFile)) { fail(`không thấy env_file ${s.cfg.envFile}`); continue; }
        if (telegram) {
          const bot = await s.tg.getMe();
          if ('@' + bot.username.toLowerCase() !== s.cfg.telegramBot) { fail(`telegram_token là của @${bot.username}, không phải ${s.cfg.telegramBot}`); continue; }
          out.push(`✔ ${code}: bot Telegram ${s.cfg.telegramBot}`);
        }
        const gh = await sh(['gh', 'auth', 'status'], s.cfg.repo, this.baseEnv(s.cfg)).catch(() => ({ code: 1, out: '', err: 'không có gh' }));
        out.push(gh.code === 0 ? `✔ ${code}: gh đã đăng nhập` : `⚠ ${code}: gh chưa sẵn sàng (${(gh.err || gh.out).split('\n')[0]}) — sẽ không tạo được PR`);
        s.enabled = true;
        s.problem = undefined;
      } catch (e) {
        fail(errText(e));
      }
    }
    return out;
  }

  /** Biến môi trường cho tiến trình con: KHÔNG kế thừa toàn bộ env của runner (tránh lộ bí mật khác) — chỉ PATH / ngôn ngữ / HOME + env_file. */
  baseEnv(a: AgentConfig): Record<string, string> {
    const env: Record<string, string> = {};
    for (const k of ['PATH', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER', 'SHELL', 'DOTNET_ROOT']) if (process.env[k]) env[k] = process.env[k]!;
    env.HOME = a.executor.home ?? process.env.HOME ?? '/tmp';
    for (const k of ['SSH_AUTH_SOCK']) if (process.env[k]) env[k] = process.env[k]!; // SSH key sẵn có của máy (ssh-agent)
    if (a.envFile && existsSync(a.envFile)) Object.assign(env, readEnvFile(a.envFile));
    env.PATH = this.git.pathWithGit(env.PATH); // CLI agent / gh / hook gọi đúng git cấu hình
    env.GIT_TERMINAL_PROMPT = '0'; // không treo chờ mật khẩu
    return env;
  }

  /** Git với HOME / PATH của agent (credential helper, SSH key, user.name của HOME đó). */
  gitFor(a: AgentConfig) { return this.git.withEnv(this.baseEnv(a)); }

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
      groupChatId: this.config.groupChatId, notifierBot: this.config.notifierBot, agentBot: s.cfg.telegramBot, employeeCode: s.cfg.employeeCode,
    });
    if (!wake.ok) { log('info', 'bỏ qua tin Telegram', { agent: s.cfg.employeeCode, reason: wake.reason }); return null; }
    return this.accept(s, wake.value);
  }

  /** Hỏi lại OfficeHub rồi xếp hàng. Trả id job (null = bỏ qua / đã có job đang chờ cho việc này). */
  async accept(s: AgentState, w: WakeData): Promise<number | null> {
    if (!s.enabled || !s.employeeId) { log('warn', 'agent đang tắt — bỏ qua', { agent: s.cfg.employeeCode, task: w.task_code, problem: s.problem }); return null; }
    try {
      const c = checkTask(await s.hub.getTask(w.task_id), w, s.employeeId);
      if (!c.ok) { log('info', 'bỏ qua việc', { agent: s.cfg.employeeCode, task: w.task_code, reason: c.reason }); return null; }
    } catch (e) {
      log('warn', 'không kiểm tra được việc — bỏ qua', { agent: s.cfg.employeeCode, task: w.task_code, error: errText(e) });
      return null;
    }
    const id = this.store.enqueue(s.cfg.employeeCode, w.task_id, w.task_code, w.project_id);
    log('info', id ? 'xếp hàng việc' : 'việc đã có job đang chờ / chạy', { agent: s.cfg.employeeCode, task: w.task_code, job: id });
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

  async process(job: Job): Promise<void> {
    const s = this.agents.get(job.agent)!;
    const ctl = new AbortController();
    this.running.set(job.id, ctl);
    const w: WakeData = { employee_code: job.agent, project_id: job.project_id, task_id: job.task_id, task_code: job.task_code };
    const jobDir = join(this.config.dataDir, 'jobs', String(job.id));
    log('info', 'bắt đầu job', { job: job.id, agent: job.agent, task: job.task_code });
    try {
      const detail = await s.hub.getTask(job.task_id);
      const c = checkTask(detail, w, s.employeeId!);
      if (!c.ok) { this.store.finish(job.id, 'skipped', { reason: c.reason }); log('info', 'bỏ job', { job: job.id, reason: c.reason }); return; }

      const git = this.gitFor(s.cfg);
      const ws = await prepareWorktree(git, s.cfg.repo, this.config.worktreesDir, job.agent, job.task_code, this.config.baseBranch);
      const prev = this.store.session(job.task_id);
      const resume = prev?.agent === job.agent && prev.session_id ? prev.session_id : undefined;
      mkdirSync(jobDir, { recursive: true });
      const prompt = buildPrompt(w, ws.branch, ws.reused || !!resume);
      const promptFile = join(jobDir, 'prompt.md'), mcpFile = join(jobDir, 'mcp.json');
      writeFileSync(promptFile, prompt, { mode: 0o600 });
      writeFileSync(mcpFile, JSON.stringify(mcpConfig(this.config.mcpUrl), null, 2), { mode: 0o600 });
      const env = { ...this.baseEnv(s.cfg), OFFICEHUB_TOKEN: s.cfg.token, [AGENT_ENV]: job.agent, [TASK_ENV]: job.task_code };

      const out = await runExecutor({ cwd: ws.path, jobDir, promptFile, prompt, mcpConfigFile: mcpFile, resumeSessionId: resume, exec: s.cfg.executor }, env, ctl.signal);
      this.store.saveSession(job.task_id, job.agent, out.sessionId ?? null, ws.branch, ws.path);

      const ch = await branchChanges(git, ws.path, this.config.baseBranch);
      let prUrl: string | undefined, note = '';
      if (ch.touchesProtected) note = '⚠ Nhánh có thay đổi trong `agent-runner/` — runner KHÔNG push. Người thật kiểm tra worktree trên máy agent.';
      else if (ch.ahead > 0) {
        try {
          prUrl = await publish(git, ws.path, ws.branch, this.config.baseBranch, `${job.task_code}: ${c.value.title}`.slice(0, 200),
            `Việc OfficeHub **${job.task_code}** — agent ${job.agent}, tạo tự động bởi agent-runner (TEST-44). Người thật review trước khi merge.`);
        } catch (e) { note = `⚠ Không push / tạo được PR: ${errText(e)}`; }
      } else note = 'Phiên kết thúc, nhánh không có commit mới.';
      if (ch.dirty) note += (note ? ' ' : '') + 'Còn thay đổi chưa commit trong worktree.';

      const ok = out.exitCode === 0 && !out.timedOut && !out.isError;
      await s.hub.comment(job.task_id, resultComment(job, out, prUrl, note, ok));
      this.store.finish(job.id, ok ? 'done' : 'failed', {
        reason: out.timedOut ? 'hết giờ' : out.isError ? `CLI báo lỗi (${out.errorKind ?? out.exitCode})` : out.exitCode !== 0 ? `mã thoát ${out.exitCode}` : note || null,
        session_id: out.sessionId ?? null, cost_usd: out.costUsd ?? null, input_tokens: out.inputTokens ?? null, output_tokens: out.outputTokens ?? null,
        turns: out.turns ?? null, pr_url: prUrl ?? null,
      });
      log(ok ? 'info' : 'warn', 'xong job', { job: job.id, task: job.task_code, ok, pr: prUrl, cost: out.costUsd, sec: out.durationSec });
    } catch (e) {
      this.store.finish(job.id, 'failed', { reason: errText(e) });
      log('error', 'job lỗi', { job: job.id, task: job.task_code, error: errText(e) });
    } finally {
      this.running.delete(job.id);
      for (const f of ['prompt.md', 'mcp.json']) rmSync(join(jobDir, f), { force: true }); // giữ output.log để tra lỗi
    }
  }

  async start() {
    const recovered = this.store.recoverRunning();
    if (recovered) log('warn', 'đưa lại job đang chạy dở vào hàng đợi', { count: recovered });
    for (const line of await this.checkAgents()) log(line.startsWith('✘') ? 'error' : line.startsWith('⚠') ? 'warn' : 'info', line);
    const enabled = [...this.agents.values()].filter((a) => a.enabled);
    if (enabled.length === 0) throw new Error('Không agent nào chạy được — xem các dòng ✘ ở trên (chạy `doctor`)');
    for (const s of enabled) void this.listen(s);
    await this.schedule();
  }

  stop() {
    this.abort.abort();
    for (const c of this.running.values()) c.abort();
  }
}

/** Bình luận runner gửi vào việc sau mỗi phiên: PR, chi phí, token, thời gian, trạng thái. Không chép output của CLI (agent tự báo kết quả). */
export function resultComment(job: Pick<Job, 'agent'>, out: RunOutcome, prUrl: string | undefined, note: string, ok: boolean): string {
  const parts = [
    `**🤖 agent-runner** (${job.agent}) — ${ok ? 'phiên kết thúc' : out.timedOut ? 'HẾT GIỜ, đã dừng phiên' : 'phiên lỗi'}`,
    prUrl ? `- PR: ${prUrl}` : null,
    `- Thời gian: ${Math.round(out.durationSec / 60)} phút${out.turns ? ` · ${out.turns} lượt` : ''}`,
    out.costUsd !== undefined ? `- Chi phí: $${out.costUsd.toFixed(2)}${out.inputTokens ? ` · ${out.inputTokens.toLocaleString('en')} token vào / ${(out.outputTokens ?? 0).toLocaleString('en')} ra` : ''}` : null,
    note ? `- ${note}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}
