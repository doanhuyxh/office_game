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
    done?: boolean;
  };
  /** Việc phải xong trước. */
  dependsOn?: { code?: string; done?: boolean }[];
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
