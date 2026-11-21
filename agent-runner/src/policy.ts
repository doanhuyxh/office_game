/** Hằng số chính sách của runner — gom một chỗ để đổi nhịp / ngưỡng không phải lục trong code. */

/** Nối phiên CLI cũ chỉ khi lần chạy trước cách ≤ ngần này phút (cache prompt còn sống) — xa hơn thì phiên mới + bản Bàn giao rẻ hơn (TEST-142). */
export const RESUME_MAX_GAP_MIN = 10;

/** Họp: nối phiên tối đa ngần này lượt liên tiếp rồi mở phiên mới (transcript dài dần, mỗi lượt đọc lại cả cuộc họp) — TEST-142. */
export const MEETING_RESUME_MAX = 8;

/** Thời gian tối đa của một lượt họp (phút) — dưới hạn nói 3 phút của OfficeHub (`AgentMeetingTurnRules.TurnTimeout`) để runner kịp bỏ lượt thay. */
export const MEETING_TURN_MAX_MIN = 2.5;

/** Agent đang họp: job việc / chat hoãn từng nhịp này (giây) rồi kiểm tra lại. */
export const MEETING_HOLD_SEC = 30;

/** Scheduler: không có job / hết slot → chờ ngần này rồi hỏi lại hàng đợi. */
export const SCHEDULE_POLL_MS = 2000;

/** Listener: `getUpdates` lỗi mà Telegram không báo `retry_after` → chờ ngần này giây rồi thử lại. */
export const TELEGRAM_RETRY_SEC = 5;

/** Bắt bù lúc khởi động (TEST-158): mỗi agent xếp tối đa ngần này việc mỗi lần `start`; phần còn lại chỉ log, lần khởi động sau lấy tiếp. */
export const STARTUP_CATCHUP_MAX = 20;

/** Bắt bù lúc khởi động: việc có job vừa kết thúc trong ngần này phút thì bỏ qua (runner khởi động lại liên tục không chạy lại cùng một việc). */
export const STARTUP_RECENT_JOB_MIN = 10;

/**
 * Nhận tin: không hỏi lại được OfficeHub (mạng / máy chủ đang deploy) → thử lại sau lần lượt ngần này giây rồi mới bỏ. Lệnh `run` không thử lại.
 * Hết lượt mà vẫn lỗi: job việc còn được bắt bù ở lần khởi động sau; chat / họp thì mất.
 */
export const ADMIT_RETRY_SEC = [30, 120, 600];
