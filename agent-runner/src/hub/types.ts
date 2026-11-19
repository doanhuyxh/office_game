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
   */
  columns?: { id?: string; wakeFollowers?: boolean; isReview?: boolean }[];
  /** Người theo dõi (TEST-160). */
  followers?: { employeeId?: string }[];
  /** Bình luận mới nhất (mặc định 20) — runner chỉ xét id / người viết / cờ BOT, không đọc nội dung. */
  comments?: { id?: string; authorName?: string; byBot?: boolean }[];
  /** Lịch sử mới nhất (mặc định 20) — như trên. */
  activities?: { id?: string; actorName?: string; byBot?: boolean }[];
  /** Việc phải xong trước. */
  dependsOn?: TaskRef[];
  /** Việc đang chờ việc này xong. */
  blocks?: TaskRef[];
}

/** Một việc liên quan trong `get_task` (dependsOn / blocks). */
export interface TaskRef {
  code?: string;
  done?: boolean;
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
