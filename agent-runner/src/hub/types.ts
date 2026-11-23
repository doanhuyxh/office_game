/**
 * Kết quả các tool MCP của OfficeHub mà runner đọc. Đây là dữ liệu từ ngoài (máy chủ có thể là bản cũ / mới hơn, tài khoản có thể không đủ
 * quyền) nên MỌI trường đều có thể thiếu — nơi dùng phải kiểm tra (`validator.ts`), không tin kiểu.
 */

/** `get_task`. */
export interface TaskDetail {
  task?: {
    id?: string;
    projectId?: string;
    code?: string;
    title?: string;
    assigneeEmployeeId?: string;
    /** Người review — chỉ OfficeHub trước TEST-178 (đã bỏ: người review là người theo dõi). */
    reviewerEmployeeId?: string;
    columnId?: string;
    done?: boolean;
  };
  /**
   * Cột trạng thái của dự án; `wakeFollowers` = việc vào cột này thì bot theo dõi được đánh thức (TEST-178 — máy chủ bỏ trường false khi gọn
   * kết quả, nên "không có trường" ở mọi cột = máy chủ bản cũ). `isReview` = cột review của OfficeHub trước TEST-178.
   * `wakeBotIds` (TEST-184) = Id nhân viên các bot được đánh thức ở cột; thiếu / rỗng = mọi bot theo dõi việc.
   */
  columns?: { id?: string; wakeFollowers?: boolean; wakeBotIds?: string[]; isReview?: boolean }[];
  /** Người theo dõi (TEST-160). */
  followers?: { employeeId?: string }[];
  /**
   * Bình luận mới nhất (mặc định 20, cũ → mới) — runner xét id / người viết / cờ BOT; `content` chỉ để tìm hash commit cần chờ có trên
   * origin trước bước theo dõi (`commitRefs`, TEST-225), không đưa vào prompt / lệnh nào khác.
   */
  comments?: { id?: string; authorName?: string; byBot?: boolean; content?: string }[];
  /** Lịch sử mới nhất (mặc định 20) — như trên. */
  activities?: { id?: string; actorName?: string; byBot?: boolean }[];
  /** Việc đứng trước: phải `ready` (không có trường → `done`) thì việc này mới bắt đầu. */
  dependsOn?: TaskRef[];
  /** Việc đang chờ việc này xong. */
  blocks?: TaskRef[];
}

/** `get_project` — runner chỉ đọc id / mã / quyền làm việc để đổi mã dự án trong `agents.yaml → projects` thành id (TEST-200). */
export interface ProjectDetail {
  project?: {
    id?: string;
    code?: string;
    /** Tài khoản của token được tạo / chuyển việc trong dự án (thành viên dự án đang chạy). */
    canWork?: boolean;
  };
}

/** Một việc liên quan trong `get_task` (dependsOn / blocks). */
export interface TaskRef {
  code?: string;
  done?: boolean;
  /**
   * Việc trước đã đủ để việc sau bắt đầu: đã xong, hoặc đã tới cột dự án đánh dấu "việc sau được bắt đầu từ cột này" (vd Deploy — đã review
   * đạt, chưa cần quản lý kéo sang Xong). OfficeHub bản cũ không trả → runner dùng `done`.
   */
  ready?: boolean;
}

/** Một dòng của `list_chats` (chỉ tài khoản bot). Kênh Toàn văn phòng có `conversation: "office"` (không lộ id). */
export interface ChatSummary {
  conversation?: string;
  type?: string;
  unread?: number;
  mentionedUnread?: number;
}

/** `get_my_meeting` (chỉ tài khoản bot): cuộc họp agent đang dự. */
export interface MeetingState {
  inMeeting?: boolean;
  sessionId?: string;
  isMyTurn?: boolean;
  isChair?: boolean;
}

/** `get_my_profile`. */
export interface ProfileResult {
  employee?: { id?: string; code?: string; fullName?: string };
}

/**
 * Một dòng của `list_my_tasks` (việc chưa xong đang giao cho tài khoản của token, sắp theo hạn). `awaitingHuman` / `projectActive` có từ
 * TEST-157 — OfficeHub bản cũ không trả.
 */
export interface MyTask {
  id?: string;
  projectId?: string;
  code?: string;
  /** Số việc phải xong trước mà chưa xong. */
  waitingOn?: number;
  /** Bot đã báo (chuyển trạng thái / bình luận) và chưa có người thật thao tác lại → đang chờ người duyệt / trả lời. */
  awaitingHuman?: boolean;
  /** Dự án đang chạy. */
  projectActive?: boolean;
}
