/**
 * Log một dòng JSON (journald / docker đọc được). Mọi chuỗi bí mật đã đăng ký (token AI, token bot Telegram) bị thay bằng "***"
 * trước khi in — kể cả khi lọt vào thông điệp lỗi.
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

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = redact(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
  (level === 'error' ? console.error : console.log)(line);
}

export const errText = (e: unknown) => redact(e instanceof Error ? e.message : String(e));
