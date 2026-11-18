import type { ExecutorConfig } from '../config';
import type { ActivityEvent } from './events';

/** Ngữ cảnh một lần chạy CLI. File MCP + prompt nằm trong thư mục tạm của job (ngoài worktree), xoá khi job xong. */
export interface ExecContext {
  cwd: string;
  jobDir: string;
  promptFile: string;
  prompt: string;
  mcpConfigFile: string;
  resumeSessionId?: string;
  exec: ExecutorConfig;
  /**
   * Tắt mọi công cụ có sẵn của CLI (Bash, đọc / ghi file…) — chỉ còn tool MCP. Dùng cho mode none (agent nghiệp vụ), chat, họp:
   * nội dung người khác viết không dẫn tới chạy lệnh trên máy. Adapter `custom` không ép được — CLI tự khai báo phải tự giới hạn.
   */
  noBuiltinTools?: boolean;
  /** Thay system prompt mặc định của CLI (claude: `--system-prompt`). Runner đặt cho phiên chỉ có tool MCP (TEST-140). Adapter `custom` bỏ qua. */
  systemPrompt?: string;
  /** Gọi mỗi khi agent làm một thao tác (đọc / sửa file, chạy lệnh, gọi MCP, nhận định) — để runner log tiến độ. */
  onActivity?: (message: string) => void;
  /** Gọi với từng sự kiện có cấu trúc (lệnh + kết quả, diff, suy nghĩ…) đã che bí mật — để gửi lên OfficeHub cho người xem trực tiếp (TEST-93). */
  onEvent?: (event: ActivityEvent) => void;
}

export interface Command {
  bin: string;
  args: string[];
}

/**
 * Chi phí / token của một model trong phiên (Claude Code: `modelUsage` của sự kiện `result`).
 * `inputTokens` = TỔNG token vào, gồm cả phần đọc / ghi cache (cách tính cũ của `report` / bình luận); TEST-135 tách thêm
 * `cacheReadTokens` / `cacheWriteTokens` (không có = CLI không báo) — gửi lên OfficeHub thì token vào = tổng − cache.
 */
export interface ModelUse {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Kết quả đọc từ output CLI (trường nào CLI không có thì undefined). */
export interface ExecResult {
  sessionId?: string;
  /** Model chính agent THỰC SỰ dùng (CLI báo). Không đọc được → model cấu hình, `modelFromConfig` = true. */
  model?: string;
  modelFromConfig?: boolean;
  /** Mọi model đã dùng trong phiên (có thể có model phụ cho tác vụ nhỏ). */
  modelUsage?: Record<string, ModelUse>;
  costUsd?: number;
  /** Tổng token vào, gồm cả cache (xem {@link ModelUse}). */
  inputTokens?: number;
  outputTokens?: number;
  /** Phần token vào đọc từ cache / ghi vào cache (TEST-135); CLI không báo → undefined. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  turns?: number;
  summary?: string;
  isError?: boolean;
  errorKind?: string;
}

export interface Adapter {
  kind: string;
  caps: {
    /** Nối được phiên cũ. */
    resume: boolean;
    /** Runner tắt được công cụ có sẵn của CLI (`noBuiltinTools`) — không thì CLI phải tự giới hạn (mode none, chat, họp). */
    toolRestriction: boolean;
  };
  /** Lỗi trong phần `executor` của cấu hình riêng adapter này (câu không kèm tiền tố `agents[i].executor.`). */
  configProblems?(exec: ExecutorConfig): string[];
  /** Cảnh báo `doctor` về HOME của CLI (thứ CLI tự nạp vào mọi phiên…). */
  homeWarnings?(exec: ExecutorConfig, home: string): string[];
  /**
   * Đường dẫn file transcript của một phiên chạy ở `cwd` (dù file có tồn tại hay không). Có hàm này → runner gửi transcript lên cloud và
   * khôi phục lại khi máy mất file (TEST-144).
   */
  transcriptFile?(home: string, cwd: string, sessionId: string): string;
  command(ctx: ExecContext): Command;
  /** Đọc từng dòng stdout, cập nhật kết quả. */
  parseLine(line: string, r: ExecResult): void;
  /** Mô tả ngắn các thao tác agent vừa làm trong dòng stdout này (rỗng nếu không có). Không bắt buộc. */
  activity?(line: string, cwd: string): string[];
  /**
   * Bộ tách sự kiện có cấu trúc cho MỘT lần chạy (có trạng thái: ghép kết quả lệnh vào đúng lệnh). Không bắt buộc — adapter không có
   * (vd `custom`) thì người xem chỉ thấy bắt đầu / kết thúc phiên do runner gửi.
   */
  events?(cwd: string): (line: string) => ActivityEvent[];
  /**
   * Chạy thử nhẹ để biết model thật (`start` / `doctor`, bỏ qua bằng --no-model-check vì tốn token). Không bắt buộc.
   * `parseProbe` đọc stdout của lệnh đó.
   */
  probe?(exec: ExecutorConfig): Command;
  /**
   * Transcript của phiên còn ở máy không (TEST-142) — không còn thì `--resume` lỗi / vô ích → runner mở phiên mới.
   * Không có hàm này (adapter `custom`) → runner chỉ xét khoảng cách thời gian.
   */
  hasSession?(home: string, cwd: string, sessionId: string): boolean;
  parseProbe?(stdout: string): ProbeResult;
  /** Sau khi tiến trình thoát (vd output text: lấy phần cuối làm tóm tắt; codex: đọc model thật từ file phiên trong `home`). */
  finish?(stdoutTail: string, r: ExecResult, home?: string): void;
}

/** Kết quả chạy thử model: model thật, lỗi; `invalidModel` = CLI báo model không tồn tại / không có quyền → agent tắt. */
export interface ProbeResult {
  model?: string;
  error?: string;
  invalidModel?: boolean;
}
