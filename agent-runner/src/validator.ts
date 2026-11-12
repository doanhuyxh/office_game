import type { TgMessage } from './telegram';

/** Dữ liệu trong tin đánh thức (TEST-42): dòng 1 nhắc tên bot, dòng 2 JSON đúng 4 trường. */
export interface WakeData { employee_code: string; project_id: string; task_id: string; task_code: string }

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['employee_code', 'project_id', 'task_id', 'task_code'];

/**
 * Bước 1 (không gọi mạng): đúng nhóm + có dòng JSON hợp lệ có `employee_code` trùng mã của agent. KHÔNG kiểm người gửi / dòng nhắc bot:
 * lớp bảo vệ thật là bước 2 (hỏi lại OfficeHub bằng token của agent — việc phải đang giao cho chính agent).
 * Tin không đạt bị bỏ qua (log lý do), KHÔNG trả lời vào nhóm.
 */
export function parseWake(msg: TgMessage, opts: { groupChatId: string; employeeCode: string }): Check<WakeData> {
  if (String(msg.chat.id) !== opts.groupChatId) return { ok: false, reason: `sai nhóm (${msg.chat.id})` };
  const line = (msg.text ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'));
  if (!line) return { ok: false, reason: 'không có dòng JSON' };
  let data: unknown;
  try { data = JSON.parse(line); } catch { return { ok: false, reason: 'dòng JSON không hợp lệ' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'JSON không phải object' };
  const d = data as Record<string, unknown>;
  if (!KEYS.every((k) => typeof d[k] === 'string' && (d[k] as string).length > 0)) return { ok: false, reason: `JSON thiếu trường chuỗi ${KEYS.join(', ')}` };
  if (!GUID.test(d.project_id as string) || !GUID.test(d.task_id as string)) return { ok: false, reason: 'project_id / task_id không phải GUID' };
  if (!/^[A-Z0-9]+-\d+$/i.test(d.task_code as string)) return { ok: false, reason: 'task_code sai dạng' };
  if ((d.employee_code as string).toUpperCase() !== opts.employeeCode) return { ok: false, reason: `mã nhân viên ${d.employee_code} không phải của agent này` };
  return { ok: true, value: { employee_code: d.employee_code as string, project_id: d.project_id as string, task_id: d.task_id as string, task_code: d.task_code as string } };
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
