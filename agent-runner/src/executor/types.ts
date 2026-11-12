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

/** Kết quả đọc từ output CLI (trường nào CLI không có thì undefined). */
export interface ExecResult {
  sessionId?: string;
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
  /** Sau khi tiến trình thoát (vd output text: lấy phần cuối làm tóm tắt). */
  finish?(stdoutTail: string, r: ExecResult): void;
}
