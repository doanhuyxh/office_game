import type { ExecutorConfig } from '../config';

/** Ngữ cảnh một lần chạy CLI. File MCP + prompt nằm trong thư mục tạm của job (ngoài worktree), xoá khi job xong. */
export interface ExecContext {
  cwd: string;
  jobDir: string;
  promptFile: string;
  prompt: string;
  mcpConfigFile: string;
  resumeSessionId?: string;
  exec: ExecutorConfig;
  /** Gọi mỗi khi agent làm một thao tác (đọc / sửa file, chạy lệnh, gọi MCP, nhận định) — để runner log tiến độ. */
  onActivity?: (message: string) => void;
}

export interface Command { bin: string; args: string[] }

/** Chi phí / token của một model trong phiên (Claude Code: `modelUsage` của sự kiện `result`). */
export interface ModelUse { costUsd?: number; inputTokens?: number; outputTokens?: number }

/** Kết quả đọc từ output CLI (trường nào CLI không có thì undefined). */
export interface ExecResult {
  sessionId?: string;
  /** Model chính agent THỰC SỰ dùng (CLI báo). Không đọc được → model cấu hình, `modelFromConfig` = true. */
  model?: string;
  modelFromConfig?: boolean;
  /** Mọi model đã dùng trong phiên (có thể có model phụ cho tác vụ nhỏ). */
  modelUsage?: Record<string, ModelUse>;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  turns?: number;
  summary?: string;
  isError?: boolean;
  errorKind?: string;
}

export interface Adapter {
  kind: string;
  caps: { resume: boolean; cost: boolean; budget: boolean };
  command(ctx: ExecContext): Command;
  /** Đọc từng dòng stdout, cập nhật kết quả. */
  parseLine(line: string, r: ExecResult): void;
  /** Mô tả ngắn các thao tác agent vừa làm trong dòng stdout này (rỗng nếu không có). Không bắt buộc. */
  activity?(line: string, cwd: string): string[];
  /**
   * Chạy thử nhẹ để biết model thật (`start` / `doctor`, bỏ qua bằng --no-model-check vì tốn token). Không bắt buộc.
   * `parseProbe` đọc stdout của lệnh đó.
   */
  probe?(exec: ExecutorConfig): Command;
  parseProbe?(stdout: string): ProbeResult;
  /** Sau khi tiến trình thoát (vd output text: lấy phần cuối làm tóm tắt). */
  finish?(stdoutTail: string, r: ExecResult): void;
}

/** Kết quả chạy thử model: model thật, lỗi; `invalidModel` = CLI báo model không tồn tại / không có quyền → agent tắt. */
export interface ProbeResult { model?: string; error?: string; invalidModel?: boolean }
