import type { ChatSummary, MeetingState, MyTask, TaskDetail, TaskRef } from './hub/types';
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
export type Wake =
  | ({ kind: 'task' } & WakeData)
  | ({ kind: 'chat' } & ChatWake)
  | ({ kind: 'meeting' } & MeetingWake)
  /**
   * `event: column_entered` (TEST-178 / 180): việc bot đang THEO DÕI vừa vào cột "Đánh thức bot theo dõi" — cùng 4 trường như tin việc
   * (`column_id`, `assignee_code` thêm bị bỏ qua: runner hỏi lại `get_task`). Tin cũ `review_requested` (TEST-167) / `task_done` (TEST-168)
   * của OfficeHub bản trước cũng thành loại này.
   */
  | ({ kind: 'follow' } & WakeData);

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_CODE = /^[A-Z0-9]+-\d+$/i;

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
  invalid: (d) => (TASK_CODE.test(d.task_code!) ? undefined : 'task_code sai dạng'),
  build: (d) => ({
    kind: 'task',
    employee_code: d.employee_code!,
    project_id: d.project_id!,
    task_id: d.task_id!,
    task_code: d.task_code!,
  }),
};

/** Tin cùng dạng tin việc nhưng là việc bot THEO DÕI. Trường thêm của máy chủ (column_id, assignee_code, project_code) bị bỏ qua. */
const FOLLOW_SHAPE: WakeShape = {
  ...TASK_SHAPE,
  build: (d) => ({ ...(TASK_SHAPE.build(d) as WakeData), kind: 'follow' }),
};

/** Loại tin theo trường `event`; `event` khác → {@link TASK_SHAPE}. */
const EVENT_SHAPES: Record<string, WakeShape> = {
  column_entered: FOLLOW_SHAPE,
  // OfficeHub trước TEST-178 — vẫn nhận để runner và máy chủ không phải nâng cấp cùng lúc
  review_requested: FOLLOW_SHAPE,
  task_done: FOLLOW_SHAPE,
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
  detail: TaskDetail | null | undefined,
  wake: Pick<WakeData, 'project_id' | 'task_id'>,
  myEmployeeId: string,
): Check<CheckedTask> {
  const t = detail?.task;
  if (!t?.id) return { ok: false, reason: 'không đọc được việc (không còn quyền / đã xoá?)' };
  if (t.id !== wake.task_id) return { ok: false, reason: 'task_id không khớp' };
  if (t.projectId !== wake.project_id) return { ok: false, reason: 'việc không thuộc project_id trong tin' };
  if (t.assigneeEmployeeId !== myEmployeeId) return { ok: false, reason: 'việc không còn giao cho agent này' };
  if (t.done) return { ok: false, reason: 'việc đã xong' };
  const waiting = (detail?.dependsOn ?? []).filter((dep) => !dep.done).map((dep) => dep.code);
  if (waiting.length) return { ok: false, reason: `việc còn chờ ${waiting.join(', ')}` };
  return {
    ok: true,
    value: {
      title: String(t.title ?? ''),
      code: String(t.code ?? ''),
      dependsOn: refs(detail?.dependsOn),
      blocks: refs(detail?.blocks),
    },
  };
}

/** Phần chung của kiểm tra việc: đọc được, đúng id / dự án. */
function sameTask(
  detail: TaskDetail | null | undefined,
  wake: Pick<WakeData, 'project_id' | 'task_id'>,
): Check<NonNullable<TaskDetail['task']>> {
  const t = detail?.task;
  if (!t?.id) return { ok: false, reason: 'không đọc được việc (không còn quyền / đã xoá?)' };
  if (t.id !== wake.task_id) return { ok: false, reason: 'task_id không khớp' };
  if (t.projectId !== wake.project_id) return { ok: false, reason: 'việc không thuộc project_id trong tin' };
  return { ok: true, value: t };
}

/**
 * Bước 2 của tin column_entered (TEST-180), lúc nhận tin VÀ ngay trước khi chạy: agent đang theo dõi việc và việc đang ở cột "Đánh thức bot
 * theo dõi" (`columns[].wakeFollowers`). Bị bỏ theo dõi / việc đã sang cột khác → bỏ. Việc đã xong vẫn chạy được (cột hoàn thành có thể bật
 * đánh thức). Agent ở trong cột nào thì làm gì là việc của hướng dẫn (agent tự đọc), runner không xét.
 * OfficeHub trước TEST-178 (chưa có `wakeFollowers`): người review (`reviewerEmployeeId`) tính như người theo dõi, cột `isReview` tính như cột
 * đánh thức, và việc đã xong tính là ở cột đánh thức (tin task_done cũ).
 */
export function checkFollow(
  detail: TaskDetail | null | undefined,
  wake: Pick<WakeData, 'project_id' | 'task_id'>,
  myEmployeeId: string,
): Check<{ title: string; code: string }> {
  const same = sameTask(detail, wake);
  if (!same.ok) return same;
  const t = same.value;
  const following =
    (detail?.followers ?? []).some((f) => f?.employeeId === myEmployeeId) || t.reviewerEmployeeId === myEmployeeId;
  if (!following) return { ok: false, reason: 'agent không còn theo dõi việc này' };
  const columns = detail?.columns ?? [];
  const column = columns.find((c) => c?.id === t.columnId);
  const legacyServer = !columns.some((c) => c && 'wakeFollowers' in c);
  const wakes = column?.wakeFollowers === true || (legacyServer && (column?.isReview === true || t.done === true));
  if (!wakes) return { ok: false, reason: 'việc không còn ở cột đánh thức bot theo dõi' };
  return { ok: true, value: { title: String(t.title ?? ''), code: String(t.code ?? '') } };
}

/**
 * Sau phiên follow (TEST-180): agent có để lại dấu vết trên việc không — bình luận / thao tác (chuyển cột, đổi người…) MỚI của chính agent so với
 * lúc trước phiên. Không có = agent tự dừng vì cột này không phải bước của vai trò mình → runner không bình luận chi phí lên việc.
 * So theo id (không so giờ: máy runner và máy chủ có thể lệch đồng hồ) và theo tên + cờ BOT (`get_task` không trả id người viết).
 * Không đọc được kết quả sau phiên / thiếu tên → coi như CÓ (thà thừa một bình luận chi phí còn hơn giấu một phiên lỗi).
 */
export function actedOnTask(
  before: TaskDetail | null | undefined,
  after: TaskDetail | null | undefined,
  myName: string | undefined,
): boolean {
  if (!after || !myName) return true;
  const seen = new Set<string>();
  for (const x of [...(before?.comments ?? []), ...(before?.activities ?? [])]) if (x?.id) seen.add(x.id);
  const mine = (x: { id?: string; byBot?: boolean } | null | undefined, name: string | undefined) =>
    !!x?.id && !seen.has(x.id) && x.byBot === true && name === myName;
  return (
    (after.comments ?? []).some((c) => mine(c, c?.authorName)) ||
    (after.activities ?? []).some((a) => mine(a, a?.actorName))
  );
}

/** Việc đã kiểm tra xong: tên, mã + mã các việc liên quan để đưa vào prompt (TEST-164). */
export interface CheckedTask {
  title: string;
  code: string;
  /** Mã việc phải xong trước (lúc chạy đều đã xong) → agent đọc bình luận BÀN GIAO của chúng. */
  dependsOn: string[];
  /** Mã việc đang chờ việc này → kết quả phải bàn giao được cho người làm sau. */
  blocks: string[];
}

/** Dữ liệu ngoài: chỉ lấy MÃ việc đúng dạng (không đưa tên / nội dung người viết vào prompt), tối đa 10. */
function refs(list: TaskRef[] | undefined): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => x?.code)
    .filter((c): c is string => typeof c === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(c))
    .slice(0, 10);
}

/**
 * Bước 2 của tin chat_mention (MCP `list_chats` bằng token của agent, lúc nhận tin VÀ ngay trước khi chạy): hội thoại còn tin @nhắc agent chưa đọc.
 * Đã đọc hết (agent vừa trả lời ở phiên trước / tin bị xoá) → bỏ, nên tin đánh thức lặp không chạy lại.
 * Kênh Toàn văn phòng: `list_chats` trả `conversation: "office"` (không lộ id) → id không khớp hội thoại nào thì xét kênh office.
 * @returns `conversation` để đưa vào prompt ("office" hoặc id).
 */
export function checkChat(list: unknown, conversationId: string): Check<{ conversation: string }> {
  const items: (ChatSummary | null | undefined)[] = Array.isArray(list) ? list : [];
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
export function checkMeeting(m: MeetingState | null | undefined, sessionId: string): Check<{ isChair: boolean }> {
  if (!m?.inMeeting) return { ok: false, reason: 'agent không dự cuộc họp nào đang diễn ra' };
  if (String(m.sessionId ?? '').toLowerCase() !== sessionId.toLowerCase())
    return { ok: false, reason: 'agent đang dự cuộc họp khác' };
  if (m.isMyTurn !== true) return { ok: false, reason: 'không phải lượt của agent' };
  return { ok: true, value: { isChair: m.isChair === true } };
}

/** Việc được chọn để bắt bù lúc khởi động — đủ trường để dựng tin đánh thức việc. */
export interface StartupTask {
  id: string;
  projectId: string;
  code: string;
}

/** Kết quả lọc `list_my_tasks`: việc cần làm (giữ thứ tự máy chủ trả — theo hạn) + số việc bị bỏ theo từng lý do. */
export interface StartupPick {
  tasks: StartupTask[];
  /** Tổng số dòng máy chủ trả. */
  total: number;
  /** Bot đã báo, đang chờ người duyệt / trả lời. */
  awaitingHuman: number;
  /** Còn chờ việc khác xong. */
  blocked: number;
  /** Dự án không còn chạy. */
  inactive: number;
  /** Dòng thiếu / sai id, dự án hoặc mã việc. */
  invalid: number;
}

/**
 * Bắt bù lúc khởi động (TEST-158, hàm thuần): từ kết quả MCP `list_my_tasks` chọn việc agent CẦN làm ngay — dự án đang chạy, không chờ việc
 * khác, và không phải việc bot đã báo xong đang chờ người (`awaitingHuman`, luật `BotWaitRules` của OfficeHub — TEST-157).
 * OfficeHub bản cũ không trả `awaitingHuman` → không đạt (không đoán: chạy lại việc đang chờ duyệt là đốt token).
 * Đây chỉ là bước chọn; từng việc vẫn qua `checkTask` (hỏi lại `get_task`) như tin đánh thức thường.
 */
export function pickStartupTasks(list: unknown): Check<StartupPick> {
  if (!Array.isArray(list)) return { ok: false, reason: 'list_my_tasks không trả danh sách' };
  const pick: StartupPick = { tasks: [], total: list.length, awaitingHuman: 0, blocked: 0, inactive: 0, invalid: 0 };
  for (const row of list as (MyTask | null | undefined)[]) {
    const { id, projectId, code } = row ?? {};
    if (
      typeof id !== 'string' ||
      typeof projectId !== 'string' ||
      typeof code !== 'string' ||
      !GUID.test(id) ||
      !GUID.test(projectId) ||
      !TASK_CODE.test(code)
    ) {
      pick.invalid++;
      continue;
    }
    if (typeof row!.awaitingHuman !== 'boolean')
      return { ok: false, reason: 'OfficeHub bản cũ: list_my_tasks chưa trả awaitingHuman (cần bản có TEST-157)' };
    if (row!.projectActive !== true) pick.inactive++;
    else if (Number(row!.waitingOn ?? 0) > 0) pick.blocked++;
    else if (row!.awaitingHuman) pick.awaitingHuman++;
    else pick.tasks.push({ id, projectId, code });
  }
  return { ok: true, value: pick };
}
