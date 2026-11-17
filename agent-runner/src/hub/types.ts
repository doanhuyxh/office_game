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
