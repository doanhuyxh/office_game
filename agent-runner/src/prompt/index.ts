import type { WorkspaceMode } from '../config';
import type { WakeData } from '../validator';
import { finish, hardRules, intro, rules } from './common';
import * as inPlace from './in-place';
import * as none from './none';
import * as worktree from './worktree';

export interface PromptContext {
  mode: WorkspaceMode;
  branch: string;
  /** Nối phiên CLI cũ (agent còn nhớ). */
  resumed: boolean;
  /** Phiên mới nhưng việc đã từng làm (worktree / nhánh / phiên cũ còn dấu) → đọc Bàn giao trước (TEST-142). */
  continued?: boolean;
}

/**
 * Prompt chung cho mọi CLI: CHỈ có mã nhân viên / mã việc / id + các bước đọc qua MCP và cách kết thúc.
 * KHÔNG chép tên / mô tả / bình luận việc (agent tự đọc qua MCP, coi là dữ liệu) — tránh đưa nội dung người khác viết vào chỉ dẫn.
 * Bước 5 (cách làm việc với git) và quy tắc git khác nhau theo mode → mỗi mode một file; phần còn lại ở common.ts.
 * Mode none (agent nghiệp vụ, không repo): bước 5 chỉ dùng tool MCP, bộ quy tắc riêng không có phần git / file.
 */
export function buildPrompt(w: WakeData, ctx: PromptContext): string {
  if (ctx.mode === 'none')
    return intro(w, ctx.resumed, ctx.continued) + none.workStep() + finish(w, false) + hardRules(none.RULES);
  const m = ctx.mode === 'in_place' ? inPlace : worktree;
  return intro(w, ctx.resumed, ctx.continued) + m.workStep(ctx.branch) + finish(w) + rules(m.GIT_RULES);
}

/** Hồ sơ tool của OfficeHub.Mcp theo loại phiên (TEST-143): `tools/list` chỉ trả tool hợp loại phiên → bớt token schema mỗi lượt gọi model. */
export type McpProfile = 'task' | 'chat' | 'meeting';

/**
 * Cấu hình MCP cho CLI (định dạng mcpServers): token KHÔNG nằm trong file mà lấy từ biến môi trường OFFICEHUB_TOKEN của tiến trình.
 * `profile` → `?profile=…` trên URL (máy chủ bản cũ bỏ qua tham số lạ → đủ tool như trước).
 */
export function mcpConfig(url: string, profile?: McpProfile) {
  let full = url;
  if (profile) {
    const u = new URL(url);
    u.searchParams.set('profile', profile);
    full = u.toString();
  }
  return {
    mcpServers: { officehub: { type: 'http', url: full, headers: { Authorization: 'Bearer ${OFFICEHUB_TOKEN}' } } },
  };
}
