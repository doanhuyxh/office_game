import type { TgMessage } from './telegram';

/** Dữ liệu tin đánh thức VIỆC (TEST-42): JSON có 4 trường (+ `event` assigned / returned / ready / mentioned — runner chưa phân biệt). */
export interface WakeData {
  employee_code: string;
  project_id: string;
  task_id: string;
  task_code: string;
}

/** Tin `event: chat_mention` (TEST-70 / TEST-81): người thật @nhắc bot trong chat — không có task_id / nội dung tin. */
export interface ChatWake {
  employee_code: string;
  conversation_id: string;
  message_id: string;
}

/** Tin `event: meeting_turn` (TEST-75 / TEST-84): bot dự họp agent vừa nhận lượt nói — không có task_id / nội dung. */
export interface MeetingWake {
  employee_code: string;
  session_id: string;
  conversation_id: string;
}

/** Tin đánh thức đã phân loại theo trường `event`. */
export type Wake = ({ kind: 'task' } & WakeData) | ({ kind: 'chat' } & ChatWake) | ({ kind: 'meeting' } & MeetingWake);

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hình dạng dòng JSON của một loại tin đánh thức: trường chuỗi bắt buộc, trường nào phải là GUID, kiểm tra riêng (nếu có) và cách dựng
 * {@link Wake}. Thêm loại tin mới = thêm một mục vào {@link EVENT_SHAPES}.
 */
interface WakeShape {
  keys: string[];
  guids: string[];
  /** Kiểm tra thêm; trả lý do nếu không đạt. */
  invalid?(d: Record<string, string>): string | undefined;
  build(d: Record<string, string>): Wake;
}

/** Tin việc (không có `event`, hoặc `event` assigned / returned / ready / mentioned). */
const TASK_SHAPE: WakeShape = {
  keys: ['employee_code', 'project_id', 'task_id', 'task_code'],
  guids: ['project_id', 'task_id'],
  invalid: (d) => (/^[A-Z0-9]+-\d+$/i.test(d.task_code!) ? undefined : 'task_code sai dạng'),
  build: (d) => ({
    kind: 'task',
    employee_code: d.employee_code!,
    project_id: d.project_id!,
    task_id: d.task_id!,
    task_code: d.task_code!,
  }),
};

/** Loại tin theo trường `event`; `event` khác → {@link TASK_SHAPE}. */
const EVENT_SHAPES: Record<string, WakeShape> = {
  chat_mention: {
    keys: ['employee_code', 'conversation_id', 'message_id'],
    guids: ['conversation_id', 'message_id'],
    build: (d) => ({
      kind: 'chat',
      employee_code: d.employee_code!,
      conversation_id: d.conversation_id!.toLowerCase(),
      message_id: d.message_id!,
    }),
  },
  meeting_turn: {
    keys: ['employee_code', 'session_id', 'conversation_id'],
    guids: ['session_id', 'conversation_id'],
    build: (d) => ({
      kind: 'meeting',
      employee_code: d.employee_code!,
      session_id: d.session_id!.toLowerCase(),
      conversation_id: d.conversation_id!,
    }),
  },
};

/**
 * Bước 1 (không gọi mạng): đúng nhóm + có dòng JSON hợp lệ có `employee_code` trùng mã của agent. KHÔNG kiểm người gửi / dòng nhắc bot:
 * lớp bảo vệ thật là bước 2 (hỏi lại OfficeHub bằng token của agent — việc phải đang giao cho chính agent).
 * Tin không đạt bị bỏ qua (log lý do), KHÔNG trả lời vào nhóm.
 */
export function parseWake(msg: TgMessage, opts: { groupChatId: string; employeeCode: string }): Check<Wake> {
  const fail = (reason: string) => ({ ok: false as const, reason });
  if (String(msg.chat.id) !== opts.groupChatId) return fail(`sai nhóm (${msg.chat.id})`);
  const line = (msg.text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('{'));
  if (!line) return fail('không có dòng JSON');
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return fail('dòng JSON không hợp lệ');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('JSON không phải object');
  const d = data as Record<string, unknown>;
  const shape = (typeof d.event === 'string' && EVENT_SHAPES[d.event]) || TASK_SHAPE;
  if (!shape.keys.every((k) => typeof d[k] === 'string' && (d[k] as string).length > 0))
    return fail(`JSON thiếu trường chuỗi ${shape.keys.join(', ')}`);
  const fields = d as Record<string, string>;
  if (!shape.guids.every((k) => GUID.test(fields[k]!))) return fail(`${shape.guids.join(' / ')} không phải GUID`);
  const invalid = shape.invalid?.(fields);
  if (invalid) return fail(invalid);
  if (fields.employee_code!.toUpperCase() !== opts.employeeCode)
    return fail(`mã nhân viên ${fields.employee_code} không phải của agent này`);
  return { ok: true, value: shape.build(fields) };
}

/**
 * Bước 2 (hỏi lại OfficeHub bằng token của agent — lớp bảo vệ thật): việc tồn tại, đúng dự án, vẫn giao cho chính agent,
 * chưa xong, không còn chờ việc khác. Gọi khi nhận tin VÀ ngay trước khi chạy.
 * @param detail kết quả MCP get_task.
 */
export function checkTask(
  detail: any,
  wake: Pick<WakeData, 'project_id' | 'task_id'>,
  myEmployeeId: string,
): Check<{ title: string; code: string }> {
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
  const c =
    items.find((x) => String(x?.conversation ?? '').toLowerCase() === id) ??
    items.find((x) => x?.conversation === 'office');
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
  if (String(m.sessionId ?? '').toLowerCase() !== sessionId.toLowerCase())
    return { ok: false, reason: 'agent đang dự cuộc họp khác' };
  if (m.isMyTurn !== true) return { ok: false, reason: 'không phải lượt của agent' };
  return { ok: true, value: { isChair: m.isChair === true } };
}
