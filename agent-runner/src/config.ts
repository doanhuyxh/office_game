import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** Cấu hình runner (agents.yaml). Kiểm tra bằng tay (không phụ thuộc thư viện) — lỗi gom thành danh sách tiếng Việt. */
export interface ExecutorConfig {
  kind: 'claude' | 'custom';
  bin: string;
  model?: string;
  home?: string;
  timeoutMin: number;
  maxBudgetUsd?: number;
  extraArgs: string[];
  /** custom */
  args?: string[];
  resumeArgs?: string[];
  outputFormat: 'text' | 'json';
}

export interface AgentConfig {
  employeeCode: string;
  telegramBot: string;
  telegramToken: string;
  token: string;
  repo: string;
  envFile?: string;
  executor: ExecutorConfig;
}

export interface RunnerConfig {
  mcpUrl: string;
  telegramApiUrl: string;
  groupChatId: string;
  notifierBot: string;
  dataDir: string;
  worktreesDir: string;
  maxParallel: number;
  baseBranch: string;
  /** File chạy git (TEST-46). Không đặt = "git" trong PATH. */
  gitBin: string;
  agents: AgentConfig[];
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super('Cấu hình runner không hợp lệ:\n- ' + problems.join('\n- '));
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const strList = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);

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
  const oh = o.officehub ?? {}, tg = o.telegram ?? {}, rn = o.runner ?? {}, gt = o.git ?? {};
  const gitBin = str(gt.executable);
  if (gitBin && !isAbsolute(gitBin)) p.push('git.executable phải là đường dẫn tuyệt đối tới file chạy git (hoặc bỏ trống = git trong PATH)');
  const mcpUrl = str(oh.mcp_url);
  if (!mcpUrl || !/^https?:\/\//.test(mcpUrl)) p.push('officehub.mcp_url phải là URL http(s) tới /mcp');
  const groupChatId = str(String(tg.group_chat_id ?? ''));
  if (!groupChatId || !/^-?\d+$/.test(groupChatId)) p.push('telegram.group_chat_id phải là số (nhóm dạng -100…)');
  const notifier = str(tg.notifier_bot);
  if (!notifier) p.push('Thiếu telegram.notifier_bot (bot thông báo của OfficeHub)');
  const dataDir = str(rn.data_dir), worktreesDir = str(rn.worktrees_dir);
  if (!dataDir || !isAbsolute(dataDir)) p.push('runner.data_dir phải là đường dẫn tuyệt đối');
  if (!worktreesDir || !isAbsolute(worktreesDir)) p.push('runner.worktrees_dir phải là đường dẫn tuyệt đối');
  const maxParallel = num(rn.max_parallel) ?? 2;
  if (maxParallel < 1 || maxParallel > 10) p.push('runner.max_parallel từ 1 đến 10');

  const agents: AgentConfig[] = [];
  const list = Array.isArray(o.agents) ? o.agents : [];
  if (list.length === 0) p.push('Chưa khai báo agent nào (agents: [...])');
  const seenCodes = new Set<string>(), seenBots = new Set<string>();
  list.forEach((a: any, i: number) => {
    const at = `agents[${i}]`;
    const code = str(a?.employee_code)?.toUpperCase();
    if (!code) p.push(`${at}.employee_code bắt buộc`);
    else if (seenCodes.has(code)) p.push(`${at}.employee_code ${code} bị trùng`);
    const bot = str(a?.telegram_bot);
    if (!bot || !/^@?[A-Za-z][A-Za-z0-9_]{1,28}bot$/i.test(bot)) p.push(`${at}.telegram_bot phải là username bot (kết thúc bằng "bot")`);
    else if (seenBots.has(normalizeBot(bot))) p.push(`${at}.telegram_bot bị trùng`);
    const tgToken = str(a?.telegram_token);
    if (!tgToken || !/^\d{5,15}:[A-Za-z0-9_-]{30,}$/.test(tgToken)) p.push(`${at}.telegram_token không đúng dạng 123456789:AA…`);
    const token = str(a?.token);
    if (!token || !token.startsWith('ohk_')) p.push(`${at}.token phải là token AI của OfficeHub (ohk_…)`);
    const repo = str(a?.repo);
    if (!repo || !isAbsolute(repo)) p.push(`${at}.repo phải là đường dẫn tuyệt đối`);
    else if (worktreesDir && isInside(repo, worktreesDir))
      p.push(`${at}: repo không được nằm trong runner.worktrees_dir`);
    // worktrees_dir NẰM TRONG repo được phép (vd .officehub-runner/worktrees): EnvLoader dừng ở gốc worktree (.git) nên không đọc .env của
    // repo chính; `doctor` / khởi động bắt buộc thư mục đó đã gitignore.
    const envFile = str(a?.env_file);
    if (envFile && !isAbsolute(envFile)) p.push(`${at}.env_file phải là đường dẫn tuyệt đối`);
    const e = a?.executor ?? {};
    const kind = e.kind;
    if (kind !== 'claude' && kind !== 'custom') p.push(`${at}.executor.kind phải là claude hoặc custom`);
    const bin = str(e.bin);
    if (!bin || !isAbsolute(bin)) p.push(`${at}.executor.bin phải là đường dẫn tuyệt đối tới CLI`);
    const timeoutMin = num(e.timeout_min) ?? 60;
    if (timeoutMin < 1 || timeoutMin > 600) p.push(`${at}.executor.timeout_min từ 1 đến 600`);
    const budget = num(e.max_budget_usd);
    if (budget !== undefined && budget <= 0) p.push(`${at}.executor.max_budget_usd phải > 0`);
    const args = strList(e.args), resumeArgs = strList(e.resume_args);
    if (kind === 'custom' && !args) p.push(`${at}.executor.args bắt buộc với kind custom`);
    const fmt = e.output?.format ?? 'text';
    if (fmt !== 'text' && fmt !== 'json') p.push(`${at}.executor.output.format là text hoặc json`);
    if (code) seenCodes.add(code);
    if (bot) seenBots.add(normalizeBot(bot));
    if (code && bot && tgToken && token && repo && bin && (kind === 'claude' || kind === 'custom'))
      agents.push({
        employeeCode: code, telegramBot: normalizeBot(bot), telegramToken: tgToken, token, repo: resolve(repo), envFile,
        executor: {
          kind, bin, model: str(e.model), home: str(e.home), timeoutMin, maxBudgetUsd: budget, extraArgs: strList(e.extra_args) ?? [],
          args, resumeArgs, outputFormat: fmt,
        },
      });
  });
  if (p.length) throw new ConfigError(p);
  return {
    mcpUrl: mcpUrl!, telegramApiUrl: (str(tg.api_url) ?? 'https://api.telegram.org').replace(/\/$/, ''), groupChatId: groupChatId!,
    notifierBot: normalizeBot(notifier!), dataDir: resolve(dataDir!), worktreesDir: resolve(worktreesDir!), maxParallel,
    baseBranch: str(rn.base_branch) ?? 'main', gitBin: gitBin ?? 'git', agents,
  };
}

/** Đọc file cấu hình YAML. Cảnh báo (không chặn) khi file đọc được bởi người khác. */
export function loadConfig(path: string): { config: RunnerConfig; warnings: string[] } {
  if (!existsSync(path)) throw new ConfigError([`Không thấy file cấu hình ${path}`]);
  const warnings: string[] = [];
  if ((statSync(path).mode & 0o077) !== 0) warnings.push(`${path} đang cho nhóm / người khác đọc — nên chmod 600 (file có token)`);
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
