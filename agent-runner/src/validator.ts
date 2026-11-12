import { normalizeBot } from './config';
import type { TgMessage } from './telegram';

/** Dữ liệu trong tin đánh thức (TEST-42): dòng 1 nhắc tên bot, dòng 2 JSON đúng 4 trường. */
export interface WakeData { employee_code: string; project_id: string; task_id: string; task_code: string }

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['employee_code', 'project_id', 'task_id', 'task_code'];

/**
 * Bước 1 (không gọi mạng): đúng nhóm, đúng bot thông báo gửi, nhắc đúng bot của agent, JSON hợp lệ, mã nhân viên khớp.
 * Tin không đạt bị bỏ qua (log lý do), KHÔNG trả lời vào nhóm.
 */
export function parseWake(msg: TgMessage, opts: { groupChatId: string; notifierBot: string; agentBot: string; employeeCode: string }): Check<WakeData> {
  if (String(msg.chat.id) !== opts.groupChatId) return { ok: false, reason: `sai nhóm (${msg.chat.id})` };
  if (!msg.from?.is_bot || !msg.from.username || normalizeBot(msg.from.username) !== opts.notifierBot)
    return { ok: false, reason: `người gửi không phải bot thông báo (${msg.from?.username ?? msg.from?.id ?? '?'})` };
  const lines = (msg.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 2) return { ok: false, reason: 'tin không đúng 2 dòng' };
  if (normalizeBot(lines[0]!) !== opts.agentBot) return { ok: false, reason: `nhắc bot khác (${lines[0]})` };
  let data: unknown;
  try { data = JSON.parse(lines[1]!); } catch { return { ok: false, reason: 'dòng 2 không phải JSON' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'JSON không phải object' };
  const d = data as Record<string, unknown>;
  const keys = Object.keys(d);
  if (keys.length !== KEYS.length || !KEYS.every((k) => typeof d[k] === 'string' && (d[k] as string).length > 0))
    return { ok: false, reason: `JSON phải đúng 4 trường chuỗi ${KEYS.join(', ')}` };
  if (!GUID.test(d.project_id as string) || !GUID.test(d.task_id as string)) return { ok: false, reason: 'project_id / task_id không phải GUID' };
  if (!/^[A-Z0-9]+-\d+$/i.test(d.task_code as string)) return { ok: false, reason: 'task_code sai dạng' };
  if ((d.employee_code as string).toUpperCase() !== opts.employeeCode) return { ok: false, reason: `mã nhân viên ${d.employee_code} không phải của agent này` };
  return { ok: true, value: d as unknown as WakeData };
}

/**
 * Bước 2 (hỏi lại OfficeHub bằng token của agent — lớp bảo vệ thật): việc tồn tại, đúng dự án, vẫn giao cho chính agent,
 * chưa xong, không còn chờ việc khác. Gọi khi nhận tin VÀ ngay trước khi chạy.
 * @param detail kết quả MCP get_task.
 */
export function checkTask(detail: any, wake: Pick<WakeData, 'project_id' | 'task_id'>, myEmployeeId: string): Check<{ title: string; code: string }> {
  const t = detail?.task;
  if (!t?.id) return { ok: false, reason: 'không đọc được việc (không còn quyền / đã xoá?)' };
  if (t.id !== wake.task_id) return { ok: false, reason: 'task_id không khớp' };
  if (t.projectId !== wake.project_id) return { ok: false, reason: 'việc không thuộc project_id trong tin' };
  if (t.assigneeEmployeeId !== myEmployeeId) return { ok: false, reason: 'việc không còn giao cho agent này' };
  if (t.done) return { ok: false, reason: 'việc đã xong' };
  const waiting = (detail.dependsOn ?? []).filter((x: any) => !x.done).map((x: any) => x.code);
  if (waiting.length) return { ok: false, reason: `việc còn chờ ${waiting.join(', ')}` };
  return { ok: true, value: { title: String(t.title ?? ''), code: String(t.code ?? '') } };
}
