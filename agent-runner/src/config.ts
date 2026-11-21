import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { adapters, type ExecutorKind, isExecutorKind } from './executor/run';

/** Cấu hình runner (agents.yaml). Kiểm tra bằng tay (không phụ thuộc thư viện) — lỗi gom thành danh sách tiếng Việt. */
export interface ExecutorConfig {
  kind: ExecutorKind;
  bin: string;
  model?: string;
  home?: string;
  timeoutMin: number;
  maxBudgetUsd?: number;
  /** claude: `--max-turns` (số vòng gọi tool tối đa của một phiên). Không đặt = không giới hạn. */
  maxTurns?: number;
  /**
   * Cấu hình nhẹ cho phiên chat_mention / meeting_turn (TEST-141): mỗi trường đè trường cùng tên của executor, không đặt = dùng executor.
   * Phiên ngắn chỉ gọi vài tool MCP rồi viết một tin → model nhỏ, ngân sách / số vòng thấp. Xem {@link lightExecutor}.
   */
  light?: { model?: string; maxBudgetUsd?: number; maxTurns?: number };
  extraArgs: string[];
  /**
   * Lệnh phải có trong PATH của agent (TEST-180), vd `[ssh, gh, curl]` cho bot DevOps: hướng dẫn dự án bảo agent chạy lệnh nào thì máy chạy agent
   * phải có lệnh đó. `doctor` / lúc khởi động kiểm tra — thiếu thì agent tắt (báo ngay, không hỏng giữa phiên deploy). Tên lệnh hoặc đường dẫn tuyệt đối.
   */
  requiredBins: string[];
  /** custom */
  args?: string[];
  resumeArgs?: string[];
  outputFormat: 'text' | 'json';
}

/**
 * Nơi agent làm việc: worktree riêng + push + PR (mặc định) | in_place = ngay trong `repo`, commit vào nhánh đang checkout rồi runner push nhánh đó lên origin, KHÔNG PR
 * | none = agent nghiệp vụ (TEST-80): không repo / git / PR, CLI chạy trong thư mục trống dưới `data_dir`, chỉ có tool MCP.
 */
export type WorkspaceMode = 'worktree' | 'in_place' | 'none';

export interface WorkspaceConfig {
  mode: WorkspaceMode;
  /** in_place: cho phép chạy khi đang ở nhánh base / main / master (mặc định từ chối). */
  allowBaseBranch: boolean;
  /** in_place: cho phép repo có file .env ở gốc (CLI chạy trong repo nên đọc được .env đó). Mặc định không. */
  allowEnvFiles: boolean;
  /**
   * none (TEST-163): phiên việc có công cụ có sẵn của CLI (chạy lệnh, đọc / ghi file trong thư mục việc) dù không có repo — cho bot thiết kế
   * (curl tải ảnh lên create_upload), DevOps (gh / ssh theo hướng dẫn). Mặc định false = chỉ tool MCP. Phiên chat / họp vẫn chỉ MCP.
   */
  builtinTools: boolean;
}

/**
 * Nơi làm của agent cho MỘT dự án OfficeHub (TEST-200): một agent (một mã NV, một bot) nhận việc của nhiều dự án, mỗi dự án một repo /
 * nhánh gốc / mode riêng — một mục của `agents[].projects`. Agent nghiệp vụ (mode none) không khai `projects`: mọi dự án dùng chung nơi
 * làm không repo ({@link defaultWorkspace}, `projectCode` rỗng).
 */
export interface ProjectWorkspace {
  /** Mã dự án trên OfficeHub (in hoa). '' = nơi làm không repo của agent mode none (mọi dự án). */
  projectCode: string;
  /** Id dự án — runner đổi từ mã lúc khởi động / `doctor` (MCP get_project). Chưa có = chưa đổi được, mục này chưa nhận việc. */
  projectId?: string;
  /** Bản clone của agent cho dự án. Mode none → chuỗi rỗng. */
  repo: string;
  /** Nhánh việc tách từ `origin/<nhánh này>`, PR merge vào nó. Mode none không dùng. */
  baseBranch: string;
  workspace: WorkspaceConfig;
  /** Lý do dự án đang tắt (mã không thấy trên OfficeHub, agent không phải thành viên, repo lỗi) — `doctor` / khởi động ghi; agent vẫn chạy. */
  problem?: string;
}

export interface AgentConfig {
  employeeCode: string;
  telegramBot: string;
  telegramToken: string;
  token: string;
  envFile?: string;
  /**
   * `workspace` cấp agent: mode none = agent nghiệp vụ (không repo, không `projects`); mode khác = mặc định cho mục `projects` không khai
   * `workspace`. Lúc chạy job đừng đọc trường này — dùng {@link workspaceFor}.
   */
  workspace: WorkspaceConfig;
  /** Repo theo dự án (TEST-200) — agent có repo BẮT BUỘC khai ít nhất một mục; agent mode none thì rỗng. */
  projects: ProjectWorkspace[];
  executor: ExecutorConfig;
}

export interface RunnerConfig {
  mcpUrl: string;
  telegramApiUrl: string;
  groupChatId: string;
  dataDir: string;
  worktreesDir: string;
  maxParallel: number;
  /** Nhánh gốc mặc định cho agent không khai `base_branch` riêng (`runner.base_branch`, mặc định main). */
  baseBranch: string;
  /** Định dạng log của runner: auto (terminal → pretty, còn lại json) | json | pretty. */
  logFormat: 'auto' | 'json' | 'pretty';
  /** Gửi sự kiện "agent đang làm gì" lên OfficeHub cho người xem trực tiếp trong 3D (TEST-99). Mặc định bật. */
  activityStream: boolean;
  /** Mỗi lần `start`, xếp luôn các việc đang giao cho agent mà không chờ tin đánh thức (TEST-158). Mặc định bật. */
  startupCatchup: boolean;
  /** File chạy git (TEST-46). Không đặt = "git" trong PATH. */
  gitBin: string;
  agents: AgentConfig[];
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super('Cấu hình runner không hợp lệ:\n- ' + problems.join('\n- '));
  }
}

/** Tên nhánh git thông dụng (chữ, số, `._/-`; không bắt đầu bằng `-` — không bị hiểu thành cờ của lệnh git). */
const BRANCH_NAME = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** Mã dự án OfficeHub (đã in hoa), vd TEST, WEB-2026. */
const PROJECT_CODE = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

/** Nơi làm dùng cho MỌI dự án của agent mode none (không repo); agent có repo → null (chỉ dự án khai trong `projects` mới có nơi làm). */
export const defaultWorkspace = (a: AgentConfig): ProjectWorkspace | null =>
  a.workspace.mode === 'none' ? { projectCode: '', repo: '', baseBranch: '', workspace: a.workspace } : null;

/** Mọi nơi làm của agent: nơi làm không repo (mode none) hoặc từng mục `projects`. */
export const agentWorkspaces = (a: AgentConfig): ProjectWorkspace[] => {
  const fallback = defaultWorkspace(a);
  return fallback ? [fallback, ...a.projects] : [...a.projects];
};

/** Mục `projects` của một dự án (theo id đã đổi từ mã) — kể cả mục đang tắt. */
export const declaredProject = (a: AgentConfig, projectId: string): ProjectWorkspace | undefined =>
  a.projects.find((p) => !!p.projectId && p.projectId.toLowerCase() === projectId.toLowerCase());

/**
 * Nơi làm (repo / nhánh gốc / mode) của agent cho việc thuộc dự án `projectId` (TEST-200): mục `projects` của dự án đó; agent mode none →
 * nơi làm không repo cho mọi dự án; dự án không khai, hoặc mục của dự án đang tắt (`problem`) → null = việc của dự án này không chạy trên máy này.
 */
export function workspaceFor(a: AgentConfig, projectId: string): ProjectWorkspace | null {
  const declared = declaredProject(a, projectId);
  if (declared) return declared.problem ? null : declared;
  return defaultWorkspace(a);
}

/**
 * Các nhánh gốc của mọi cặp (agent, dự án) dùng chung một repo (đã sắp xếp, không trùng) — hook pre-push nằm ở `.git/hooks` chung của repo
 * nên phải chặn push lên nhánh gốc của MỌI nơi dùng repo đó, và nội dung hook không được đổi qua lại theo agent / dự án vừa chạy.
 */
export const repoBaseBranches = (config: Pick<RunnerConfig, 'agents'>, repo: string): string[] =>
  [
    ...new Set(
      config.agents
        .flatMap(agentWorkspaces)
        .filter((w) => w.repo === repo && w.workspace.mode !== 'none')
        .map((w) => w.baseBranch),
    ),
  ].sort();

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const strList = (v: unknown) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined;

/** Username bot Telegram chuẩn hoá: "@…" chữ thường. */
export const normalizeBot = (v: string) => '@' + v.trim().replace(/^@/, '').toLowerCase();

/** `child` có nằm trong (hoặc trùng) `parent` không. */
export const isInside = (child: string, parent: string) => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export function parseConfig(raw: unknown): RunnerConfig {
  const p: string[] = [];
  const o = (raw ?? {}) as Record<string, any>;
  const oh = o.officehub ?? {},
    tg = o.telegram ?? {},
    rn = o.runner ?? {},
    gt = o.git ?? {};
  const gitBin = str(gt.executable);
  if (gitBin && !isAbsolute(gitBin))
    p.push('git.executable phải là đường dẫn tuyệt đối tới file chạy git (hoặc bỏ trống = git trong PATH)');
  const mcpUrl = str(oh.mcp_url);
  if (!mcpUrl || !/^https?:\/\//.test(mcpUrl)) p.push('officehub.mcp_url phải là URL http(s) tới /mcp');
  const groupChatId = str(String(tg.group_chat_id ?? ''));
  if (!groupChatId || !/^-?\d+$/.test(groupChatId)) p.push('telegram.group_chat_id phải là số (nhóm dạng -100…)');
  const dataDir = str(rn.data_dir),
    worktreesDir = str(rn.worktrees_dir);
  if (!dataDir || !isAbsolute(dataDir)) p.push('runner.data_dir phải là đường dẫn tuyệt đối');
  if (!worktreesDir || !isAbsolute(worktreesDir)) p.push('runner.worktrees_dir phải là đường dẫn tuyệt đối');
  const logFormat = rn.log_format ?? 'auto';
  if (!['auto', 'json', 'pretty'].includes(logFormat)) p.push('runner.log_format là auto, json hoặc pretty');
  if (rn.activity_stream !== undefined && typeof rn.activity_stream !== 'boolean')
    p.push('runner.activity_stream là true hoặc false');
  const activityStream = rn.activity_stream !== false;
  if (rn.startup_catchup !== undefined && typeof rn.startup_catchup !== 'boolean')
    p.push('runner.startup_catchup là true hoặc false');
  const startupCatchup = rn.startup_catchup !== false;
  const defaultBase = str(rn.base_branch) ?? 'main';
  if (!BRANCH_NAME.test(defaultBase)) p.push('runner.base_branch phải là tên nhánh (vd main, developer)');
  const maxParallel = num(rn.max_parallel) ?? 2;
  if (maxParallel < 1 || maxParallel > 10) p.push('runner.max_parallel từ 1 đến 10');

  /** `workspace` của agent / một mục projects: mode + cờ; ghi lỗi vào danh sách, luôn trả giá trị đã chuẩn hoá. */
  const parseWorkspace = (raw: unknown, at: string): WorkspaceConfig => {
    const w = (raw ?? {}) as Record<string, unknown>;
    const mode = w.mode ?? 'worktree';
    const known = mode === 'worktree' || mode === 'in_place' || mode === 'none';
    if (!known) p.push(`${at}.workspace.mode là worktree, in_place hoặc none`);
    for (const k of ['allow_base_branch', 'allow_env_files', 'builtin_tools'])
      if (w[k] !== undefined && typeof w[k] !== 'boolean') p.push(`${at}.workspace.${k} là true / false`);
    if (w.builtin_tools === true && mode !== 'none')
      p.push(`${at}.workspace.builtin_tools chỉ dùng với mode none (worktree / in_place đã có sẵn công cụ)`);
    return {
      mode: known ? mode : 'worktree',
      allowBaseBranch: w.allow_base_branch === true,
      allowEnvFiles: w.allow_env_files === true,
      builtinTools: w.builtin_tools === true,
    };
  };
  /** Repo phải là đường dẫn tuyệt đối, ngoài `worktrees_dir`. Trả true khi đạt. */
  const checkRepo = (repo: string | undefined, at: string): boolean => {
    if (!repo || !isAbsolute(repo)) p.push(`${at}.repo phải là đường dẫn tuyệt đối`);
    else if (worktreesDir && isInside(repo, worktreesDir))
      p.push(`${at}: repo không được nằm trong runner.worktrees_dir`);
    else return true;
    return false;
  };

  const agents: AgentConfig[] = [];
  const list = Array.isArray(o.agents) ? o.agents : [];
  if (list.length === 0) p.push('Chưa khai báo agent nào (agents: [...])');
  const seenCodes = new Set<string>(),
    seenBots = new Set<string>();
  list.forEach((a: any, i: number) => {
    const at = `agents[${i}]`;
    const code = str(a?.employee_code)?.toUpperCase();
    if (!code) p.push(`${at}.employee_code bắt buộc`);
    else if (seenCodes.has(code)) p.push(`${at}.employee_code ${code} bị trùng`);
    const bot = str(a?.telegram_bot);
    if (!bot || !/^@?[A-Za-z][A-Za-z0-9_]{1,28}bot$/i.test(bot))
      p.push(`${at}.telegram_bot phải là username bot (kết thúc bằng "bot")`);
    else if (seenBots.has(normalizeBot(bot))) p.push(`${at}.telegram_bot bị trùng`);
    const tgToken = str(a?.telegram_token);
    if (!tgToken || !/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(tgToken))
      p.push(`${at}.telegram_token không đúng dạng 123456789:AA…`);
    const token = str(a?.token);
    if (!token || !token.startsWith('ohk_')) p.push(`${at}.token phải là token AI của OfficeHub (ohk_…)`);
    const workspace = parseWorkspace(a?.workspace, at);
    const mode = workspace.mode;
    if (a?.projects !== undefined && !Array.isArray(a.projects))
      p.push(`${at}.projects phải là danh sách (mỗi mục: project, repo, base_branch, workspace)`);
    const projectList: any[] = Array.isArray(a?.projects) ? a.projects : [];
    if (mode === 'none' && projectList.length)
      p.push(`${at}: workspace.mode none (agent nghiệp vụ, không repo) không khai được projects`);
    // Repo chỉ khai theo dự án (TEST-200). Mode none (agent nghiệp vụ) không có repo; `repo` khai ở cấp agent thì bỏ qua.
    if (mode !== 'none') {
      if (a?.repo !== undefined && a?.repo !== null)
        p.push(`${at}.repo không còn dùng — chuyển vào ${at}.projects: [{ project: <mã dự án OfficeHub>, repo: … }]`);
      if (Array.isArray(a?.projects) && projectList.length === 0)
        p.push(`${at}.projects phải có ít nhất một dự án (project + repo)`);
      if (a?.projects === undefined || a?.projects === null)
        p.push(
          `${at}.projects bắt buộc — mỗi dự án OfficeHub agent làm một mục (project + repo); agent không repo dùng workspace.mode none`,
        );
    }
    // worktrees_dir NẰM TRONG repo được phép (vd .officehub-runner/worktrees): EnvLoader dừng ở gốc worktree (.git) nên không đọc .env của
    // repo chính; `doctor` / khởi động bắt buộc thư mục đó đã gitignore.
    const envFile = str(a?.env_file);
    if (envFile && !isAbsolute(envFile)) p.push(`${at}.env_file phải là đường dẫn tuyệt đối`);
    const e = a?.executor ?? {};
    const kind = e.kind;
    if (!isExecutorKind(kind)) p.push(`${at}.executor.kind phải là ${Object.keys(adapters).join(' hoặc ')}`);
    const bin = str(e.bin);
    if (!bin || !isAbsolute(bin)) p.push(`${at}.executor.bin phải là đường dẫn tuyệt đối tới CLI`);
    const timeoutMin = num(e.timeout_min) ?? 60;
    if (timeoutMin < 1 || timeoutMin > 600) p.push(`${at}.executor.timeout_min từ 1 đến 600`);
    const budget = num(e.max_budget_usd);
    if (budget !== undefined && budget <= 0) p.push(`${at}.executor.max_budget_usd phải > 0`);
    const maxTurns = int(e.max_turns);
    if (e.max_turns !== undefined && (maxTurns === undefined || maxTurns < 1 || maxTurns > 500))
      p.push(`${at}.executor.max_turns là số nguyên từ 1 đến 500`);
    // TEST-141: cấu hình nhẹ cho chat / họp
    let light: ExecutorConfig['light'];
    if (e.light !== undefined && e.light !== null) {
      const l = e.light;
      if (typeof l !== 'object' || Array.isArray(l))
        p.push(`${at}.executor.light phải là một mục (model / max_budget_usd / max_turns)`);
      else {
        const lb = num(l.max_budget_usd),
          lt = int(l.max_turns);
        if (l.model !== undefined && !str(l.model)) p.push(`${at}.executor.light.model phải là tên model`);
        if (l.max_budget_usd !== undefined && (lb === undefined || lb <= 0))
          p.push(`${at}.executor.light.max_budget_usd phải > 0`);
        if (l.max_turns !== undefined && (lt === undefined || lt < 1 || lt > 500))
          p.push(`${at}.executor.light.max_turns là số nguyên từ 1 đến 500`);
        for (const k of Object.keys(l))
          if (!['model', 'max_budget_usd', 'max_turns'].includes(k))
            p.push(`${at}.executor.light.${k}: không hỗ trợ (chỉ model, max_budget_usd, max_turns)`);
        light = { model: str(l.model), maxBudgetUsd: lb, maxTurns: lt };
      }
    }
    const args = strList(e.args),
      resumeArgs = strList(e.resume_args);
    const requiredBins = strList(e.required_bins) ?? [];
    if (e.required_bins !== undefined && !strList(e.required_bins))
      p.push(`${at}.executor.required_bins là danh sách tên lệnh (vd [ssh, gh, curl])`);
    for (const b of requiredBins)
      if (!(isAbsolute(b) || /^[A-Za-z0-9._+-]+$/.test(b)))
        p.push(`${at}.executor.required_bins: "${b}" không phải tên lệnh / đường dẫn tuyệt đối`);
    const fmt = e.output?.format ?? 'text';
    const executorOf = (kind: ExecutorKind): ExecutorConfig => ({
      kind,
      bin: bin!,
      model: str(e.model),
      home: str(e.home),
      timeoutMin,
      maxBudgetUsd: budget,
      maxTurns,
      light,
      extraArgs: strList(e.extra_args) ?? [],
      requiredBins,
      args,
      resumeArgs,
      outputFormat: fmt,
    });
    if (fmt !== 'text' && fmt !== 'json') p.push(`${at}.executor.output.format là text hoặc json`);
    if (code) seenCodes.add(code);
    if (bot) seenBots.add(normalizeBot(bot));
    const executor = isExecutorKind(kind) && bin ? executorOf(kind) : undefined;
    if (executor)
      for (const problem of adapters[executor.kind].configProblems?.(executor) ?? [])
        p.push(`${at}.executor.${problem}`);
    const agentBase = str(a?.base_branch);
    if (a?.base_branch !== undefined && !(agentBase && BRANCH_NAME.test(agentBase)))
      p.push(`${at}.base_branch phải là tên nhánh (vd main, developer, release/2.0)`);
    // TEST-200: repo theo dự án — mỗi mục một dự án OfficeHub; base_branch / workspace không khai → theo cấp agent.
    const projects: ProjectWorkspace[] = [];
    const seenProjects = new Set<string>();
    projectList.forEach((x: any, j: number) => {
      const pt = `${at}.projects[${j}]`;
      const projectCode = str(x?.project)?.toUpperCase();
      if (!projectCode || !PROJECT_CODE.test(projectCode))
        p.push(`${pt}.project bắt buộc — mã dự án trên OfficeHub (vd TEST, WEB-2026)`);
      else if (seenProjects.has(projectCode)) p.push(`${pt}.project ${projectCode} bị trùng trong cùng agent`);
      else seenProjects.add(projectCode);
      const projectRepo = str(x?.repo);
      const repoOk = checkRepo(projectRepo, pt);
      const projectBase = str(x?.base_branch);
      if (x?.base_branch !== undefined && !(projectBase && BRANCH_NAME.test(projectBase)))
        p.push(`${pt}.base_branch phải là tên nhánh (vd main, developer, release/2.0)`);
      const own = x?.workspace === undefined || x?.workspace === null ? workspace : parseWorkspace(x.workspace, pt);
      if (own.mode === 'none')
        p.push(`${pt}.workspace.mode none không dùng trong projects (dự án không repo thì không khai)`);
      if (projectCode && repoOk)
        projects.push({
          projectCode,
          repo: resolve(projectRepo!),
          baseBranch: projectBase ?? agentBase ?? defaultBase,
          workspace: own,
        });
    });
    if (code && bot && tgToken && token && executor)
      agents.push({
        employeeCode: code,
        telegramBot: normalizeBot(bot),
        telegramToken: tgToken,
        token,
        envFile,
        workspace,
        projects,
        executor,
      });
  });
  // in_place làm việc thẳng trong repo (không có worktree ngăn cách) → repo đó không được dùng chung với agent khác hay dự án khác:
  // xét trên từng cặp (agent, dự án).
  const places = agents.flatMap((a) =>
    agentWorkspaces(a)
      .filter((w) => w.workspace.mode !== 'none')
      .map((w) => ({ w, who: w.projectCode ? `${a.employeeCode} (dự án ${w.projectCode})` : a.employeeCode })),
  );
  for (const x of places.filter((y) => y.w.workspace.mode === 'in_place'))
    if (places.some((y) => y !== x && y.w.repo === x.w.repo))
      p.push(`${x.who}: workspace in_place nhưng repo ${x.w.repo} bị agent / dự án khác dùng chung`);
  if (p.length) throw new ConfigError(p);
  return {
    mcpUrl: mcpUrl!,
    telegramApiUrl: (str(tg.api_url) ?? 'https://api.telegram.org').replace(/\/$/, ''),
    groupChatId: groupChatId!,
    dataDir: resolve(dataDir!),
    worktreesDir: resolve(worktreesDir!),
    maxParallel,
    baseBranch: defaultBase,
    gitBin: gitBin ?? 'git',
    logFormat,
    activityStream,
    startupCatchup,
    agents,
  };
}

/**
 * Executor cho phiên chat / họp (TEST-141): trường nào `light` có thì đè, còn lại giữ executor của agent (không khai báo `light` → y như cũ).
 * Kết quả không còn `light` (tránh áp hai lần).
 */
export function lightExecutor(e: ExecutorConfig): ExecutorConfig {
  const { light, ...base } = e;
  if (!light) return base;
  return {
    ...base,
    model: light.model ?? e.model,
    maxBudgetUsd: light.maxBudgetUsd ?? e.maxBudgetUsd,
    maxTurns: light.maxTurns ?? e.maxTurns,
  };
}

/** Đọc file cấu hình YAML. Cảnh báo (không chặn) khi file đọc được bởi người khác. */
export function loadConfig(path: string): { config: RunnerConfig; warnings: string[] } {
  if (!existsSync(path)) throw new ConfigError([`Không thấy file cấu hình ${path}`]);
  const warnings: string[] = [];
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0)
    warnings.push(`${path} đang cho nhóm / người khác đọc — nên chmod 600 (file có token)`);
  return { config: parseConfig(Bun.YAML.parse(readFileSync(path, 'utf8'))), warnings };
}

/** Đọc env_file dạng KEY=VALUE (bỏ dòng trống / #). Không hỗ trợ nội suy. */
export function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}
