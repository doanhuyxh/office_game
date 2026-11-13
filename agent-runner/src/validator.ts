import type { TgMessage } from './telegram';

/** Dữ liệu tin đánh thức VIỆC (TEST-42): JSON có 4 trường (+ `event` assigned / returned / ready / mentioned — runner chưa phân biệt). */
export interface WakeData { employee_code: string; project_id: string; task_id: string; task_code: string }

/** Tin `event: chat_mention` (TEST-70 / TEST-81): người thật @nhắc bot trong chat — không có task_id / nội dung tin. */
export interface ChatWake { employee_code: string; conversation_id: string; message_id: string }

/** Tin `event: meeting_turn` (TEST-75 / TEST-84): bot dự họp agent vừa nhận lượt nói — không có task_id / nội dung. */
export interface MeetingWake { employee_code: string; session_id: string; conversation_id: string }

/** Tin đánh thức đã phân loại theo trường `event`. */
export type Wake = ({ kind: 'task' } & WakeData) | ({ kind: 'chat' } & ChatWake) | ({ kind: 'meeting' } & MeetingWake);

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['employee_code', 'project_id', 'task_id', 'task_code'];

/**
 * Bước 1 (không gọi mạng): đúng nhóm + có dòng JSON hợp lệ có `employee_code` trùng mã của agent. KHÔNG kiểm người gửi / dòng nhắc bot:
 * lớp bảo vệ thật là bước 2 (hỏi lại OfficeHub bằng token của agent — việc phải đang giao cho chính agent).
 * Tin không đạt bị bỏ qua (log lý do), KHÔNG trả lời vào nhóm.
 */
export function parseWake(msg: TgMessage, opts: { groupChatId: string; employeeCode: string }): Check<Wake> {
  if (String(msg.chat.id) !== opts.groupChatId) return { ok: false, reason: `sai nhóm (${msg.chat.id})` };
  const line = (msg.text ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'));
  if (!line) return { ok: false, reason: 'không có dòng JSON' };
  let data: unknown;
  try { data = JSON.parse(line); } catch { return { ok: false, reason: 'dòng JSON không hợp lệ' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, reason: 'JSON không phải object' };
  const d = data as Record<string, unknown>;
  const mine = () => String(d.employee_code).toUpperCase() === opts.employeeCode;
  const notMine = { ok: false as const, reason: `mã nhân viên ${d.employee_code} không phải của agent này` };
  if (d.event === 'chat_mention') {
    const keys = ['employee_code', 'conversation_id', 'message_id'];
    if (!keys.every((k) => typeof d[k] === 'string' && (d[k] as string).length > 0)) return { ok: false, reason: `JSON thiếu trường chuỗi ${keys.join(', ')}` };
    if (!GUID.test(d.conversation_id as string) || !GUID.test(d.message_id as string)) return { ok: false, reason: 'conversation_id / message_id không phải GUID' };
    if (!mine()) return notMine;
    return { ok: true, value: { kind: 'chat', employee_code: d.employee_code as string, conversation_id: (d.conversation_id as string).toLowerCase(), message_id: d.message_id as string } };
  }
  if (d.event === 'meeting_turn') {
    const keys = ['employee_code', 'session_id', 'conversation_id'];
    if (!keys.every((k) => typeof d[k] === 'string' && (d[k] as string).length > 0)) return { ok: false, reason: `JSON thiếu trường chuỗi ${keys.join(', ')}` };
    if (!GUID.test(d.session_id as string) || !GUID.test(d.conversation_id as string)) return { ok: false, reason: 'session_id / conversation_id không phải GUID' };
    if (!mine()) return notMine;
    return { ok: true, value: { kind: 'meeting', employee_code: d.employee_code as string, session_id: (d.session_id as string).toLowerCase(), conversation_id: d.conversation_id as string } };
  }
  if (!KEYS.every((k) => typeof d[k] === 'string' && (d[k] as string).length > 0)) return { ok: false, reason: `JSON thiếu trường chuỗi ${KEYS.join(', ')}` };
  if (!GUID.test(d.project_id as string) || !GUID.test(d.task_id as string)) return { ok: false, reason: 'project_id / task_id không phải GUID' };
  if (!/^[A-Z0-9]+-\d+$/i.test(d.task_code as string)) return { ok: false, reason: 'task_code sai dạng' };
  if (!mine()) return notMine;
  return { ok: true, value: { kind: 'task', employee_code: d.employee_code as string, project_id: d.project_id as string, task_id: d.task_id as string, task_code: d.task_code as string } };
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

/**
 * Bước 2 của tin chat_mention (MCP `list_chats` bằng token của agent, lúc nhận tin VÀ ngay trước khi chạy): hội thoại còn tin @nhắc agent chưa đọc.
 * Đã đọc hết (agent vừa trả lời ở phiên trước / tin bị xoá) → bỏ, nên tin đánh thức lặp không chạy lại.
 * Kênh Toàn văn phòng: `list_chats` trả `conversation: "office"` (không lộ id) → id không khớp hội thoại nào thì xét kênh office.
 * @returns `conversation` để đưa vào prompt ("office" hoặc id).
 */
export function checkChat(list: any, conversationId: string): Check<{ conversation: string }> {
  const items: any[] = Array.isArray(list) ? list : [];
  const id = conversationId.toLowerCase();
  const c = items.find((x) => String(x?.conversation ?? '').toLowerCase() === id) ?? items.find((x) => x?.conversation === 'office');
  if (!c) return { ok: false, reason: 'agent không ở trong hội thoại này' };
  if (!(Number(c.mentionedUnread) > 0)) return { ok: false, reason: 'không còn tin nhắc chưa đọc' };
  return { ok: true, value: { conversation: String(c.conversation) } };
}

/**
 * Bước 2 của tin meeting_turn (MCP `get_my_meeting` bằng token của agent, lúc nhận tin VÀ ngay trước khi chạy): agent đang dự đúng phiên họp đó
 * và đang giữ lượt. Phiên đã dừng / hết trần, lượt đã qua (quá hạn nói, người mở dừng họp) → bỏ, chỉ log.
 */
export function checkMeeting(m: any, sessionId: string): Check<{ isChair: boolean }> {
  if (!m?.inMeeting) return { ok: false, reason: 'agent không dự cuộc họp nào đang diễn ra' };
  if (String(m.sessionId ?? '').toLowerCase() !== sessionId.toLowerCase()) return { ok: false, reason: 'agent đang dự cuộc họp khác' };
  if (m.isMyTurn !== true) return { ok: false, reason: 'không phải lượt của agent' };
  return { ok: true, value: { isChair: m.isChair === true } };
}
