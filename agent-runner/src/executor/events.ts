import { homedir } from 'node:os';
import { redact } from '../log';
import type { ExecResult } from './types';

/**
 * Sự kiện "agent đang làm gì" gửi lên OfficeHub (TEST-93) — người đứng gần bot trong văn phòng 3D bấm vào bot là xem được trực tiếp.
 * Hợp đồng: `BotActivityEvent` ở `backend/.../BuildingBlocks/Office/BotActivityFeed.cs` (server gán seq / giờ, cắt lại lần nữa).
 * Gửi lại cùng `id` = cập nhật sự kiện cũ (trường không gửi giữ giá trị cũ) — dùng cho kết quả lệnh về sau.
 *
 * AI ĐỨNG GẦN BOT CŨNG XEM ĐƯỢC → mọi trường chữ đi qua {@link mask}; file nhạy cảm ({@link isSensitivePath}) chỉ gửi đường dẫn;
 * nội dung file được đọc và tham số tool OfficeHub không bao giờ gửi.
 */
export type ActivityKind =
  | 'session_start' | 'session_end' | 'command' | 'file_edit' | 'file_write' | 'file_read' | 'search' | 'thinking' | 'say' | 'tool';

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  title?: string;
  text?: string;
  path?: string;
  diff?: string;
  output?: string;
  ok?: boolean;
  task?: string;
  model?: string;
  turns?: number;
  costUsd?: number;
}

/** Giới hạn độ dài — khớp `BotActivityFeedRoute` (server cắt lại; cắt ở đây để không gửi thừa). */
export const LIMITS = { id: 64, title: 200, text: 4_000, path: 400, diffLines: 200, diffChars: 16_000, output: 4_000, task: 200, model: 100 } as const;

export const HIDDEN = '(nội dung ẩn: file nhạy cảm)';
export const HIDDEN_OUTPUT = '(kết quả ẩn: lệnh đụng tới file / biến bí mật)';

export const SESSION_START_ID = 'session';
export const SESSION_END_ID = 'session-end';

/**
 * Che bí mật trong chữ sắp gửi đi: chuỗi đã đăng ký (token AI, token bot — {@link redact}) + các mẫu hay gặp
 * (token `ohk_…`, khoá riêng PEM, `Bearer …`, `password=…` / `"apiKey": "…"`, chuỗi kết nối có mật khẩu). Thà che nhầm còn hơn lộ.
 */
export function mask(text: string): string {
  return redact(text)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***')
    .replace(/\bohk_[A-Za-z0-9_-]{8,}/g, '***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b(\d{6,}:[A-Za-z0-9_-]{30,})\b/g, '***') // token bot Telegram
    .replace(/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, '$1***@') // user:pass@host
    .replace(/(?<![A-Za-z0-9])((?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_]*["']?\s*[=:]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/gi, '$1***');
  // Mẫu cuối che cả code vô hại kiểu `token: string` — chấp nhận: thà che nhầm còn hơn lộ.
}

const SENSITIVE_NAME = /^(\.env(\..*)?|.*\.env|.*\.(pem|key|p12|pfx|jks|keystore)|agents\.ya?ml|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.netrc|\.pgpass|credentials(\.json)?|secrets?\.(json|ya?ml))$/i;

/** File không được lộ nội dung: `.env*`, khoá (`*.pem`, `*.key`, `id_rsa*`…), `agents.yaml` của runner, file thông tin đăng nhập. */
export function isSensitivePath(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? '';
  return SENSITIVE_NAME.test(name);
}

/** Lệnh bash có đụng tới file / biến bí mật không (→ ẩn kết quả lệnh): tên file nhạy cảm trong lệnh, hoặc in biến môi trường. */
export function isSensitiveCommand(command: string): boolean {
  if (/(^|[\s;|&(`])(env|printenv|export|set)(\s*($|[|;&>)]))/.test(command) || /\bprintenv\b/.test(command)) return true;
  return command.split(/[\s"'`=;|&<>()]+/).some((w) => w.length > 1 && isSensitivePath(w));
}

/** Đường dẫn để hiển thị: trong `cwd` → tương đối; trong HOME → `~/…`; còn lại giữ nguyên. */
export function displayPath(file: string, cwd: string, home = homedir()): string {
  if (!file) return '';
  if (file === cwd) return '.';
  if (file.startsWith(cwd + '/')) return file.slice(cwd.length + 1);
  if (home && file.startsWith(home + '/')) return '~/' + file.slice(home.length + 1);
  return file;
}

/** Một dòng: gộp khoảng trắng, cắt giữ đầu. */
export function oneLine(t: string, max: number): string {
  const one = t.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

/** Nhiều dòng, cắt giữ ĐẦU (lệnh, suy nghĩ, lời agent). */
export function head(t: string, max: number): string {
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Nhiều dòng, cắt giữ ĐUÔI (kết quả lệnh: phần cuối mới là lỗi / tổng kết). */
export function tail(t: string, max: number): string {
  return t.length > max ? '…' + t.slice(t.length - (max - 1)) : t;
}

/** Diff dạng dòng `-` / `+`, tối đa {@link LIMITS.diffLines} dòng / {@link LIMITS.diffChars} ký tự (dòng cuối `…` nếu bị cắt). */
export function diffOf(removed: string, added: string): string {
  const lines = (s: string, sign: string) => (s === '' ? [] : s.replace(/\n$/, '').split('\n').map((l) => sign + l));
  return cutDiff([...lines(removed, '-'), ...lines(added, '+')]);
}

export function cutDiff(lines: string[]): string {
  let out = lines.length > LIMITS.diffLines ? [...lines.slice(0, LIMITS.diffLines - 1), '…'] : lines;
  let s = out.join('\n');
  if (s.length > LIMITS.diffChars) {
    out = s.slice(0, LIMITS.diffChars - 2).split('\n');
    out.pop(); // dòng cuối có thể bị cắt giữa chừng
    s = [...out, '…'].join('\n');
  }
  return s;
}

/** Che bí mật + cắt độ dài mọi trường chữ của một sự kiện (bước cuối trước khi gửi — mọi adapter đều đi qua đây). */
export function sanitize(e: ActivityEvent): ActivityEvent {
  const out: ActivityEvent = { id: e.id.slice(0, LIMITS.id), kind: e.kind };
  if (e.title) out.title = oneLine(mask(e.title), LIMITS.title);
  if (e.text) out.text = head(mask(e.text), LIMITS.text);
  if (e.path) out.path = oneLine(e.path, LIMITS.path);
  if (e.diff) out.diff = cutDiff(mask(e.diff).split('\n'));
  if (e.output) out.output = tail(mask(e.output), LIMITS.output);
  if (e.ok !== undefined) out.ok = e.ok;
  if (e.task) out.task = oneLine(mask(e.task), LIMITS.task);
  if (e.model) out.model = oneLine(e.model, LIMITS.model);
  if (e.turns !== undefined && e.turns >= 0) out.turns = e.turns;
  if (e.costUsd !== undefined && e.costUsd >= 0) out.costUsd = e.costUsd;
  return out;
}

/** Bắt đầu job: "MÃ · tên việc" + model cấu hình (model thật chỉ biết khi CLI chạy xong → nằm trong {@link sessionEnd}). */
export function sessionStart(task: string, model?: string): ActivityEvent {
  return sanitize({ id: SESSION_START_ID, kind: 'session_start', title: 'Bắt đầu', task, model });
}

/** Hết job: số lượt, chi phí, model thật — đọc từ kết quả CLI (adapter nào cũng có, kể cả `custom`). */
export function sessionEnd(r: ExecResult, task?: string): ActivityEvent {
  return sanitize({ id: SESSION_END_ID, kind: 'session_end', title: r.isError ? 'Kết thúc (lỗi)' : 'Kết thúc', ok: !r.isError,
    task, model: r.model, turns: r.turns, costUsd: r.costUsd });
}
