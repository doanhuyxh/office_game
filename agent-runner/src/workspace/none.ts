import { mkdirSync } from 'node:fs';
import { workDir } from '../core/paths';
import type { WorkspaceStrategy } from './strategy';

/**
 * Mode none — agent nghiệp vụ (TEST-80): không repo / git / PR. CLI chạy trong thư mục trống CỐ ĐỊNH theo việc (nối phiên khi việc bị trả về),
 * chỉ có tool MCP. Không có gì để push: kết quả nằm trên OfficeHub (agent tự bình luận), runner chỉ báo thời gian / chi phí.
 */
export const noneWorkspace: WorkspaceStrategy = {
  mode: 'none',
  noBuiltinTools: true,
  async prepare(c, job) {
    const path = workDir(c.config.dataDir, job.agent, job.task_code.toUpperCase());
    mkdirSync(path, { recursive: true });
    return { path, branch: '', hasHistory: false, publish: async () => ({ note: '' }) };
  },
};
