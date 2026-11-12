import type { WorkspaceMode } from '../config';
import type { WakeData } from '../validator';
import { finish, intro, rules } from './common';
import * as inPlace from './in-place';
import * as worktree from './worktree';

export interface PromptContext {
  mode: WorkspaceMode;
  branch: string;
  /** Phiên nối tiếp (việc từng làm / bị trả về). */
  resumed: boolean;
}

/**
 * Prompt chung cho mọi CLI: CHỈ có mã nhân viên / mã việc / id + các bước đọc qua MCP và cách kết thúc.
 * KHÔNG chép tên / mô tả / bình luận việc (agent tự đọc qua MCP, coi là dữ liệu) — tránh đưa nội dung người khác viết vào chỉ dẫn.
 * Bước 5 (cách làm việc với git) và quy tắc git khác nhau theo mode → mỗi mode một file; phần còn lại ở common.ts.
 */
export function buildPrompt(w: WakeData, ctx: PromptContext): string {
  const m = ctx.mode === 'in_place' ? inPlace : worktree;
  return intro(w, ctx.resumed) + m.workStep(ctx.branch) + finish(w) + rules(m.GIT_RULES);
}

/** Cấu hình MCP cho CLI (định dạng mcpServers): token KHÔNG nằm trong file mà lấy từ biến môi trường OFFICEHUB_TOKEN của tiến trình. */
export function mcpConfig(url: string) {
  return { mcpServers: { officehub: { type: 'http', url, headers: { Authorization: 'Bearer ${OFFICEHUB_TOKEN}' } } } };
}
