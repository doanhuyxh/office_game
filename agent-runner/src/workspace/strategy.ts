import type { AgentConfig, ProjectWorkspace, RunnerConfig, WorkspaceMode } from '../config';
import type { Job } from '../store';
import type { Git } from './git';

/**
 * Thứ một mode workspace cần để chuẩn bị nơi làm cho job: cấu hình runner + agent, nơi làm của DỰ ÁN mà job thuộc về (repo / nhánh gốc / cờ —
 * TEST-200, không đọc thẳng `agent.repo`), git với HOME / PATH của agent.
 */
export interface WorkspaceContext {
  config: RunnerConfig;
  agent: AgentConfig;
  place: ProjectWorkspace;
  git: Git;
}

/** Kết quả đẩy sản phẩm của phiên: link PR (worktree), ghi chú cho bình luận kết quả, nhãn lỗi ngắn cho văn phòng 3D. */
export interface Published {
  prUrl?: string;
  note: string;
  failure?: string;
}

/** Nơi làm đã chuẩn bị xong cho một job. */
export interface PreparedWorkspace {
  /** Thư mục CLI chạy. */
  path: string;
  /** Nhánh làm việc; mode none → ''. */
  branch: string;
  /** Nơi làm còn dấu việc cũ (worktree dùng lại, nhánh đã có ở local / origin) → phiên mới phải đọc Bàn giao trước. */
  hasHistory: boolean;
  /** Sau phiên: đẩy sản phẩm (push + PR / push nhánh / không gì). `title` = tiêu đề PR. */
  publish(title: string): Promise<Published>;
}

/**
 * Một mode `workspace.mode`: chuẩn bị nơi làm trước phiên và đẩy sản phẩm sau phiên. Thêm mode mới = một file hiện thực interface này +
 * một dòng trong registry `workspace/index.ts` (+ prompt của mode ở `prompt/`, kiểm tra `doctor`).
 */
export interface WorkspaceStrategy {
  mode: WorkspaceMode;
  /** Phiên chỉ có tool MCP (không chạy lệnh / đọc ghi file trên máy). */
  noBuiltinTools: boolean;
  /** Chuẩn bị nơi làm; chưa đủ điều kiện (repo bẩn, sai nhánh…) → ném `WorkspaceRefused`. */
  prepare(c: WorkspaceContext, job: Job): Promise<PreparedWorkspace>;
}
