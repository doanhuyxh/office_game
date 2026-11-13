import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isInside, readEnvFile, type AgentConfig, type RunnerConfig } from './config';
import { modelLine, modelMatches } from './executor/model';
import { adapters, runExecutor, type RunOutcome } from './executor/run';
import type { ExecutorConfig } from './config';
import { errText, log, redact, registerSecret } from './log';
import { OfficeHubClient } from './officehub';
import { PresenceReporter } from './presence';
import { buildPrompt, mcpConfig } from './prompt';
import { Store, type Job } from './store';
import { TelegramClient, type TgMessage } from './telegram';
import { checkTask, parseWake, type WakeData } from './validator';
import { AGENT_ENV, Git, TASK_ENV, WorkspaceRefused, branchChanges, inPlaceChanges, installHooks, prepareInPlace, prepareWorktree, publish, removeHooks, sh } from './workspace';

interface AgentState {
  cfg: AgentConfig;
  hub: OfficeHubClient;
  tg: TelegramClient;
  /** Trạng thái đang làm / rảnh trong văn phòng 3D (bàn ↔ Khu nghỉ). */
  presence: PresenceReporter;
  employeeId?: string;
  enabled: boolean;
  problem?: string;
  /** Model thật đọc được lúc chạy thử (`checkAgents`, TEST-64). */
  model?: string;
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
        presence: new PresenceReporter(config.mcpUrl, a.token, a.employeeCode),
      });
    }
  }

  /**
   * Kiểm tra từng agent (giống `doctor`): CLI chạy được, token đúng nhân viên, repo git có origin, hook pre-push, bot Telegram đúng username.
   * Agent lỗi bị tắt riêng, các agent khác vẫn chạy. Trả danh sách dòng kết quả.
   * `modelCheck` (TEST-64): adapter có `probe` (claude) → chạy thử một lượt để đọc model thật; model sai → agent tắt, lệch cấu hình → cảnh báo.
   * Tốn vài trăm token mỗi agent → tắt bằng `--no-model-check`.
   */
  async checkAgents(only?: string, telegram = true, modelCheck = true): Promise<string[]> {
    const out: string[] = [];
    // TEST-46: git sai đường dẫn → mọi agent tắt (không nhận việc).
    let gitError: string | null = null;
    try { out.push(`✔ git: ${await this.git.version()} (${this.config.gitBin})`); } catch (e) { gitError = errText(e); }
    for (const s of this.agents.values()) {
      if (only && s.cfg.employeeCode !== only) continue;
      const code = s.cfg.employeeCode;
      const fail = (m: string) => { s.enabled = false; s.problem = m; out.push(`✘ ${code}: ${m}`); };
      const none = s.cfg.workspace.mode === 'none';
      if (gitError && !none) { fail(gitError); continue; } // mode none không dùng git
      try {
        if (!existsSync(s.cfg.executor.bin)) { fail(`không thấy CLI ${s.cfg.executor.bin}`); continue; }
        const v = await sh([s.cfg.executor.bin, '--version'], '/', this.baseEnv(s.cfg));
        if (v.code !== 0) { fail(`${s.cfg.executor.bin} --version lỗi: ${v.err || v.out}`); continue; }
        const conf = s.cfg.executor.model ? `model cấu hình ${s.cfg.executor.model}` : 'model: mặc định của CLI (không cấu hình)';
        out.push(`✔ ${code}: CLI ${s.cfg.executor.kind} ${s.cfg.executor.bin} — ${v.out.split('\n')[0]} · ${conf}`);
        const me = await s.hub.me();
        if (me.code !== code) { fail(`token thuộc nhân viên ${me.code}, không phải ${code}`); continue; }
        s.employeeId = me.id;
        out.push(`✔ ${code}: token AI đúng nhân viên (${me.fullName})`);
        if (none) {
          // Agent nghiệp vụ (TEST-80): không repo / git / hook / gh. CLI chạy trong thư mục trống dưới data_dir, chỉ có tool MCP.
          const work = this.workDir(code, 'x');
          out.push(`✔ ${code}: workspace none — không repo / git / PR; CLI chạy trong ${dirname(work)}, chỉ tool MCP`);
          if (s.cfg.executor.kind !== 'claude') out.push(`⚠ ${code}: adapter ${s.cfg.executor.kind} — runner không tắt được công cụ có sẵn của CLI (chạy lệnh, đọc / ghi file); CLI phải tự giới hạn`);
          const above = projectFilesAbove(work);
          if (above.length) out.push(`⚠ ${code}: thư mục chạy nằm dưới ${above.join(', ')} — CLI có thể nạp hướng dẫn / repo đó; đặt runner.data_dir ra ngoài mọi repo`);
        } else {
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
          if (s.cfg.workspace.mode === 'in_place') {
            const removed = await removeHooks(git, s.cfg.repo); // in_place không dùng hook
            out.push(`✔ ${code}: repo ${s.cfg.repo}, mode in_place không dùng hook${removed.length ? ` — đã gỡ hook của runner: ${removed.join(', ')}` : ''}`);
          } else {
            const hookWarns = await installHooks(git, s.cfg.repo, this.config.baseBranch);
            for (const w of hookWarns) out.push(`⚠ ${code}: ${w}`);
            out.push(`✔ ${code}: repo ${s.cfg.repo}, hook pre-push (chặn main / force push / agent-runner/) + commit-msg (trailer) đã cài`);
          }
          if (s.cfg.workspace.mode === 'in_place') {
            // CLI chạy thẳng trong repo → đọc được .env ở gốc repo (worktree ngoài repo thì không). Mặc định từ chối.
            const envFiles = readdirSync(s.cfg.repo).filter((f) => f === '.env' || (f.startsWith('.env.') && !/\.(example|sample|template)$/.test(f)));
            if (envFiles.length && !s.cfg.workspace.allowEnvFiles) { fail(`workspace in_place nhưng repo có ${envFiles.join(', ')} — CLI đọc được file này; dùng bản clone riêng không có .env (hoặc workspace.allow_env_files: true)`); continue; }
            if (envFiles.length) out.push(`⚠ ${code}: repo có ${envFiles.join(', ')} và CLI đọc được (allow_env_files)`);
            const cur = (await git.run(s.cfg.repo, 'symbolic-ref', '--short', '-q', 'HEAD')).out;
            const dirty = (await git.run(s.cfg.repo, 'status', '--porcelain')).out;
            out.push(`✔ ${code}: workspace in_place — commit thẳng vào nhánh đang checkout, KHÔNG push / PR (hiện: ${cur || 'detached HEAD'})`);
            if (!cur || (!s.cfg.workspace.allowBaseBranch && [this.config.baseBranch, 'main', 'master'].includes(cur))) out.push(`⚠ ${code}: nhánh hiện tại không dùng được cho in_place — việc sẽ bị từ chối cho tới khi chuyển nhánh`);
            if (dirty) out.push(`⚠ ${code}: repo đang có thay đổi chưa commit — việc sẽ bị từ chối cho tới khi sạch`);
          }
        }
        if (s.cfg.envFile && !existsSync(s.cfg.envFile)) { fail(`không thấy env_file ${s.cfg.envFile}`); continue; }
        if (telegram) {
          const bot = await s.tg.getMe();
          if ('@' + bot.username.toLowerCase() !== s.cfg.telegramBot) { fail(`telegram_token là của @${bot.username}, không phải ${s.cfg.telegramBot}`); continue; }
          out.push(`✔ ${code}: bot Telegram ${s.cfg.telegramBot}`);
        }
        if (s.cfg.workspace.mode === 'worktree') {
          const gh = await sh(['gh', 'auth', 'status'], s.cfg.repo, this.baseEnv(s.cfg)).catch(() => ({ code: 1, out: '', err: 'không có gh' }));
          out.push(gh.code === 0 ? `✔ ${code}: gh đã đăng nhập` : `⚠ ${code}: gh chưa sẵn sàng (${(gh.err || gh.out).split('\n')[0]}) — sẽ không tạo được PR`);
        }
        // Chạy thử model sau cùng: chỉ tốn token khi mọi kiểm tra khác đã qua.
        const model = await this.checkModel(s, modelCheck);
        if (model.fail) { fail(model.fail); continue; }
        out.push(model.line);
        s.enabled = true;
        s.problem = undefined;
      } catch (e) {
        fail(errText(e));
      }
    }
    return out;
  }

  /** Model thật của agent (TEST-64): `fail` = model không hợp lệ (agent tắt); `line` = dòng ✔ / ⚠ cho doctor / log khởi động. */
  private async checkModel(s: AgentState, enabled: boolean): Promise<{ line: string; fail?: string }> {
    const code = s.cfg.employeeCode, configured = s.cfg.executor.model;
    const adapter = adapters[s.cfg.executor.kind];
    if (!adapter?.probe || !adapter.parseProbe) return { line: `✔ ${code}: model ${configured ?? 'mặc định của CLI'} (adapter ${s.cfg.executor.kind} không chạy thử — đọc model từ output mỗi job nếu có)` };
    if (!enabled) return { line: `✔ ${code}: model ${configured ?? 'mặc định của CLI'} — chưa kiểm tra (--no-model-check)` };
    const cmd = adapter.probe(s.cfg.executor);
    const r = await sh([cmd.bin, ...cmd.args], this.config.dataDir, this.baseEnv(s.cfg), 120_000);
    const p = adapter.parseProbe(r.out);
    if (p.invalidModel) return { line: '', fail: `model ${configured ?? '(mặc định)'} không hợp lệ: ${p.error}` };
    if (p.error || !p.model) return { line: `⚠ ${code}: chạy thử model lỗi (${p.error ?? `không đọc được model, mã thoát ${r.code}`}) — vẫn bật agent` };
    s.model = p.model;
    if (!modelMatches(configured, p.model)) return { line: `⚠ ${code}: model thật ${p.model} KHÁC cấu hình ${configured}` };
    return { line: `✔ ${code}: model thật ${p.model}${configured ? (configured === p.model ? '' : ` (cấu hình ${configured})`) : ' (mặc định của CLI)'}` };
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
      groupChatId: this.config.groupChatId, employeeCode: s.cfg.employeeCode,
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

  /**
   * Thư mục chạy của phiên không có repo (mode none; sau này chat / họp): `{data_dir}/work/{mã NV}/{tên}` — trống, CỐ ĐỊNH theo việc
   * (CLI tìm phiên để nối theo thư mục chạy → việc bị trả về phải chạy lại đúng thư mục cũ).
   */
  workDir(agent: string, name: string) { return join(this.config.dataDir, 'work', agent, name.replace(/[^A-Za-z0-9._-]/g, '_')); }

  private jobDir(job: Pick<Job, 'id'>) { return join(this.config.dataDir, 'jobs', String(job.id)); }

  async process(job: Job): Promise<void> {
    const s = this.agents.get(job.agent)!;
    const ctl = new AbortController();
    this.running.set(job.id, ctl);
    log('info', 'bắt đầu job', { job: job.id, agent: job.agent, task: job.task_code });
    try {
      await this.processTask(s, job, ctl.signal);
    } catch (e) {
      this.store.finish(job.id, 'failed', { reason: errText(e) });
      log('error', 'job lỗi', { job: job.id, task: job.task_code, error: errText(e) });
    } finally {
      this.running.delete(job.id);
      for (const f of ['prompt.md', 'mcp.json']) rmSync(join(this.jobDir(job), f), { force: true }); // giữ output.log để tra lỗi
    }
  }

  /**
   * Chạy CLI của agent cho một job: ghi prompt + cấu hình MCP vào thư mục tạm của job, env riêng (không kế thừa env runner), log từng thao tác.
   * `presence` = có báo thao tác lên văn phòng 3D không; `noBuiltinTools` = chỉ tool MCP.
   */
  private async runSession(s: AgentState, job: Job, signal: AbortSignal,
    o: { cwd: string; prompt: string; resume?: string; exec?: ExecutorConfig; noBuiltinTools?: boolean; presence: boolean }): Promise<RunOutcome> {
    const jobDir = this.jobDir(job), exec = o.exec ?? s.cfg.executor;
    mkdirSync(jobDir, { recursive: true });
    const promptFile = join(jobDir, 'prompt.md'), mcpFile = join(jobDir, 'mcp.json');
    writeFileSync(promptFile, o.prompt, { mode: 0o600 });
    writeFileSync(mcpFile, JSON.stringify(mcpConfig(this.config.mcpUrl), null, 2), { mode: 0o600 });
    const env = { ...this.baseEnv(s.cfg), OFFICEHUB_TOKEN: s.cfg.token, [AGENT_ENV]: job.agent, [TASK_ENV]: job.task_code };
    const onActivity = (action: string) => {
      log('info', 'agent đang làm', { job: job.id, agent: job.agent, task: job.task_code, action });
      if (o.presence) s.presence.activity(action);
      // activity.log: bản đọc được của phiên (output.log là stream-json thô) — mỗi thao tác một dòng kèm giờ.
      try { appendFileSync(join(jobDir, 'activity.log'), redact(`${new Date().toTimeString().slice(0, 8)}  ${action}\n`)); } catch { /* không chặn job vì log */ }
    };
    // Dòng đầu job ghi model: adapter claude tự báo từ sự kiện system/init; adapter khác chỉ biết model cấu hình.
    if (!adapters[exec.kind]?.activity) onActivity(`Model ${exec.model ? `${exec.model} (cấu hình)` : 'mặc định của CLI'}`);
    const out = await runExecutor({ cwd: o.cwd, jobDir, promptFile, prompt: o.prompt, mcpConfigFile: mcpFile, resumeSessionId: o.resume, exec,
      noBuiltinTools: o.noBuiltinTools, onActivity }, env, signal);
    if (out.model && !out.modelFromConfig && !modelMatches(exec.model, out.model))
      log('warn', 'model thật khác cấu hình', { job: job.id, agent: job.agent, task: job.task_code, model: out.model, configured: exec.model });
    return out;
  }

  /** Ghi kết quả phiên vào hàng đợi (trạng thái, chi phí, token, model). Trả `ok`. */
  private finishJob(job: Job, out: RunOutcome, f: { note?: string; prUrl?: string } = {}): boolean {
    const ok = out.exitCode === 0 && !out.timedOut && !out.isError;
    this.store.finish(job.id, ok ? 'done' : 'failed', {
      reason: out.timedOut ? 'hết giờ' : out.isError ? `CLI báo lỗi (${out.errorKind ?? out.exitCode})` : out.exitCode !== 0 ? `mã thoát ${out.exitCode}` : f.note || null,
      session_id: out.sessionId ?? null, cost_usd: out.costUsd ?? null, input_tokens: out.inputTokens ?? null, output_tokens: out.outputTokens ?? null,
      turns: out.turns ?? null, pr_url: f.prUrl ?? null,
      model: out.model ? out.model + (out.modelFromConfig ? ' (cấu hình)' : '') : null,
      model_usage: out.modelUsage ? JSON.stringify(out.modelUsage) : null,
    });
    log(ok ? 'info' : 'warn', 'xong job', { job: job.id, task: job.task_code, ok, model: out.model, pr: f.prUrl, cost: out.costUsd, sec: out.durationSec });
    return ok;
  }

  /** Job việc: kiểm tra lại việc → chuẩn bị nơi làm (worktree / in_place / none) → chạy CLI → push + PR (worktree) → bình luận kết quả. */
  private async processTask(s: AgentState, job: Job, signal: AbortSignal): Promise<void> {
    const w: WakeData = { employee_code: job.agent, project_id: job.project_id, task_id: job.task_id, task_code: job.task_code };
    try {
      const detail = await s.hub.getTask(job.task_id);
      const c = checkTask(detail, w, s.employeeId!);
      if (!c.ok) { this.store.finish(job.id, 'skipped', { reason: c.reason }); log('info', 'bỏ job', { job: job.id, reason: c.reason }); return; }
      s.presence.working(job.task_code, c.value.title);

      const mode = s.cfg.workspace.mode;
      const git = this.gitFor(s.cfg);
      let ws: { path: string; branch: string; reused: boolean }, startHead = '';
      if (mode === 'none') {
        // Agent nghiệp vụ: không git. Thư mục trống cố định theo việc (nối phiên khi việc bị trả về).
        ws = { path: this.workDir(job.agent, job.task_code.toUpperCase()), branch: '', reused: false };
        mkdirSync(ws.path, { recursive: true });
      } else {
        if (mode === 'in_place') {
          // in_place không dùng hook → gỡ hook của runner nếu còn (hook của người dùng giữ nguyên).
          const removed = await removeHooks(git, s.cfg.repo);
          if (removed.length) log('info', 'đã gỡ hook của runner (in_place không dùng)', { job: job.id, agent: job.agent, hooks: removed });
        } else {
          // worktree: hook có thể bị xoá sau lúc khởi động → trước mỗi job kiểm tra, thiếu thì tạo lại (hook khác của người dùng: không ghi đè, chỉ cảnh báo).
          for (const m of await installHooks(git, s.cfg.repo, this.config.baseBranch)) log('warn', 'hook git', { job: job.id, agent: job.agent, message: m });
        }
        try {
          if (mode === 'in_place') {
            const r = await prepareInPlace(git, s.cfg.repo, this.config.baseBranch, s.cfg.workspace.allowBaseBranch);
            ws = { path: r.path, branch: r.branch, reused: false };
            startHead = r.head;
          } else ws = await prepareWorktree(git, s.cfg.repo, this.config.worktreesDir, job.agent, job.task_code, this.config.baseBranch);
        } catch (e) {
          if (!(e instanceof WorkspaceRefused)) throw e;
          // Workspace chưa sẵn sàng (đang bẩn / sai nhánh…) — không chạy agent, báo lại trong việc để người xử lý rồi giao lại.
          this.store.finish(job.id, 'skipped', { reason: e.message });
          await s.hub.comment(job.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy: ${e.message}`).catch(() => undefined);
          log('warn', 'bỏ job — workspace chưa sẵn sàng', { job: job.id, task: job.task_code, reason: e.message });
          return;
        }
      }
      const prev = this.store.session(job.task_id);
      const resume = prev?.agent === job.agent && prev.session_id ? prev.session_id : undefined;
      const prompt = buildPrompt(w, { mode, branch: ws.branch, resumed: ws.reused || !!resume });
      const out = await this.runSession(s, job, signal, { cwd: ws.path, prompt, resume, noBuiltinTools: mode === 'none', presence: true });
      this.store.saveSession(job.task_id, job.agent, out.sessionId ?? null, ws.branch, ws.path);

      let prUrl: string | undefined, note = '';
      if (mode === 'none') {
        // Không có gì để push: kết quả nằm trên OfficeHub (agent tự bình luận), runner chỉ báo thời gian / chi phí.
      } else if (mode === 'in_place') {
        // in_place: chỉ commit trong workspace — KHÔNG push, KHÔNG PR. Người thật xem lại commit rồi tự push.
        const ch = await inPlaceChanges(git, ws.path, startHead, ws.branch);
        note = ch.ahead > 0
          ? `${ch.ahead} commit mới trên nhánh \`${ch.branchNow || ws.branch}\` (CHƯA push): ${ch.commits.slice(0, 5).map((c) => `\`${c}\``).join(', ')}${ch.ahead > 5 ? ', …' : ''}`
          : 'Phiên kết thúc, không có commit mới.';
        if (ch.touchesProtected) note += ' ⚠ Có thay đổi trong `agent-runner/` — người thật xem lại / bỏ commit đó trước khi push.';
        if (ch.branchChanged) note += ` ⚠ Agent đã đổi nhánh (${ws.branch} → ${ch.branchNow || 'detached HEAD'}) trái quy tắc — kiểm tra repo.`;
        if (ch.dirty) note += ' Còn thay đổi chưa commit trong workspace.';
      } else {
        const ch = await branchChanges(git, ws.path, this.config.baseBranch);
        if (ch.touchesProtected) note = '⚠ Nhánh có thay đổi trong `agent-runner/` — runner KHÔNG push. Người thật kiểm tra worktree trên máy agent.';
        else if (ch.ahead > 0) {
          try {
            prUrl = await publish(git, ws.path, ws.branch, this.config.baseBranch, `${job.task_code}: ${c.value.title}`.slice(0, 200),
              `Việc OfficeHub **${job.task_code}** — agent ${job.agent}, tạo tự động bởi agent-runner (TEST-44). Người thật review trước khi merge.`);
          } catch (e) { note = `⚠ Không push / tạo được PR: ${errText(e)}`; }
        } else note = 'Phiên kết thúc, nhánh không có commit mới.';
        if (ch.dirty) note += (note ? ' ' : '') + 'Còn thay đổi chưa commit trong worktree.';
      }

      const ok = out.exitCode === 0 && !out.timedOut && !out.isError;
      await s.hub.comment(job.task_id, resultComment(job, out, prUrl, note, ok, s.cfg.executor.model));
      this.finishJob(job, out, { note, prUrl });
    } finally {
      s.presence.idle();
    }
  }

  async start(modelCheck = true) {
    const recovered = this.store.recoverRunning();
    if (recovered) log('warn', 'đưa lại job đang chạy dở vào hàng đợi', { count: recovered });
    for (const line of await this.checkAgents(undefined, true, modelCheck)) log(line.startsWith('✘') ? 'error' : line.startsWith('⚠') ? 'warn' : 'info', line);
    const enabled = [...this.agents.values()].filter((a) => a.enabled);
    if (enabled.length === 0) throw new Error('Không agent nào chạy được — xem các dòng ✘ ở trên (chạy `doctor`)');
    for (const s of enabled) { s.presence.start(); void this.listen(s); }
    await this.schedule();
  }

  stop() {
    this.abort.abort();
    for (const s of this.agents.values()) s.presence.stop();
    for (const c of this.running.values()) c.abort();
  }
}

/**
 * Bình luận runner gửi vào việc sau mỗi phiên: PR, thời gian, model (TEST-64), chi phí, token, trạng thái.
 * Không chép output của CLI (agent tự báo kết quả).
 */
export function resultComment(job: Pick<Job, 'agent'>, out: RunOutcome, prUrl: string | undefined, note: string, ok: boolean, configuredModel?: string): string {
  const parts = [
    `**🤖 agent-runner** (${job.agent}) — ${ok ? 'phiên kết thúc' : out.timedOut ? 'HẾT GIỜ, đã dừng phiên' : 'phiên lỗi'}`,
    prUrl ? `- PR: ${prUrl}` : null,
    `- Thời gian: ${Math.round(out.durationSec / 60)} phút${out.turns ? ` · ${out.turns} lượt` : ''}`,
    `- Model: ${modelLine(out, configuredModel)}`,
    out.costUsd !== undefined ? `- Chi phí: $${out.costUsd.toFixed(2)}${out.inputTokens ? ` · ${out.inputTokens.toLocaleString('en')} token vào / ${(out.outputTokens ?? 0).toLocaleString('en')} ra` : ''}` : null,
    note ? `- ${note}` : null,
  ];
  return parts.filter(Boolean).join('\n');
}

/**
 * File dự án nằm ở thư mục cha của `dir` (CLAUDE.md / AGENTS.md / .git): CLI chạy trong `dir` có thể nạp hướng dẫn của repo đó
 * → `doctor` cảnh báo cho mode none (thư mục chạy phải nằm ngoài mọi repo).
 */
export function projectFilesAbove(dir: string): string[] {
  const found: string[] = [];
  for (let d = dirname(dir); ; d = dirname(d)) {
    for (const f of ['CLAUDE.md', 'AGENTS.md', '.git']) if (existsSync(join(d, f))) found.push(join(d, f));
    if (dirname(d) === d) return found;
  }
}
