/**
 * Log của runner. Hai định dạng:
 *  - json   : mỗi sự kiện một dòng JSON (journald / docker / máy đọc) — mặc định khi stdout KHÔNG phải terminal (systemd).
 *  - pretty : một dòng dễ đọc cho người, có màu khi là terminal — mặc định khi chạy tay (`start`, `run`, `doctor`).
 * Chọn bằng `runner.log_format` (auto | json | pretty) hoặc biến RUNNER_LOG_FORMAT. Mọi chuỗi bí mật đã đăng ký (token AI, token bot
 * Telegram) bị thay bằng "***" trước khi in — kể cả khi lọt vào thông điệp lỗi.
 */
const secrets = new Set<string>();

export function registerSecret(s: string | undefined) {
  if (s && s.length >= 8) secrets.add(s);
}

export function redact(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('***');
  return out;
}

type Level = 'info' | 'warn' | 'error';
export type LogFormat = 'auto' | 'json' | 'pretty';

let format: LogFormat = 'auto';
export function setLogFormat(f: LogFormat) { format = f; }

const usePretty = () => {
  const f = (process.env.RUNNER_LOG_FORMAT as LogFormat | undefined) ?? format;
  return f === 'pretty' || (f !== 'json' && !!process.stdout.isTTY);
};
const useColor = () => !!process.stdout.isTTY && !process.env.NO_COLOR;

const ANSI = { dim: '\x1b[2m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', reset: '\x1b[0m' };

/** Ký hiệu đầu dòng theo loại thao tác của agent (đoán từ chữ đầu của mô tả — xem describeBlock). */
const GLYPHS: [RegExp, string, RegExp?][] = [
  [/^Đọc /, '·'], [/^(Sửa|Ghi) /, '✎'], [/^Chạy: /, '$', /^Chạy: /], [/^Tìm: /, '?', /^Tìm: /], [/^OfficeHub /, '⇄'], [/^Nói: /, '›', /^Nói: /], [/^Giao việc phụ/, '↳'],
  [/^Model /, '▶', /^Model /], // dòng đầu job (TEST-64): `▶ claude-opus-5-5`
];
/** `ký hiệu + mô tả`; ký hiệu đã nói rõ loại thao tác thì bỏ chữ thừa ("$ bun test" thay vì "$ Chạy: bun test"). */
function actionText(action: string) {
  const g = GLYPHS.find(([re]) => re.test(action));
  return `${g?.[1] ?? '·'} ${g?.[2] ? action.replace(g[2], '') : action}`;
}

const HIDE = new Set(['job', 'agent', 'task', 'action']);
const hhmmss = (d: Date) => d.toTimeString().slice(0, 8);

/**
 * Dựng một dòng log (hàm thuần để test). pretty: `10:21:07 NV120 TEST-45 #3  ✎ Sửa src/a.ts`; sự kiện khác: `10:21:07 NV120 TEST-45 #3  xong job ok=true cost=0.42`.
 * Trường `agent` / `task` / `job` gộp lên đầu dòng, các trường còn lại in `khoá=giá trị`.
 */
export function formatLine(level: Level, msg: string, fields: Record<string, unknown>, fmt: 'json' | 'pretty', color = false, now = new Date()): string {
  if (fmt === 'json') return JSON.stringify({ t: now.toISOString(), level, msg, ...fields });
  const c = (code: string, text: string) => (color ? code + text + ANSI.reset : text);
  const who = [fields.agent, fields.task].filter(Boolean).join(' ');
  const job = fields.job !== undefined ? `#${fields.job}` : '';
  const head = [c(ANSI.dim, hhmmss(now)), who && c(ANSI.cyan, who.padEnd(11)), job && c(ANSI.dim, job.padEnd(4))].filter(Boolean).join(' ');
  const isAction = typeof fields.action === 'string';
  const text = isAction ? actionText(fields.action as string) : msg;
  const rest = Object.entries(fields)
    .filter(([k, v]) => !HIDE.has(k) && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  const body = level === 'error' ? c(ANSI.red, `✘ ${text}`) : level === 'warn' ? c(ANSI.yellow, `⚠ ${text}`) : isAction ? text : c(ANSI.bold, text);
  return `${head}  ${body}${rest ? ' ' + c(ANSI.dim, rest) : ''}`;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = redact(formatLine(level, msg, fields, usePretty() ? 'pretty' : 'json', useColor()));
  (level === 'error' ? console.error : console.log)(line);
}

export const errText = (e: unknown) => redact(e instanceof Error ? e.message : String(e));
