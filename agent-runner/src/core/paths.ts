import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Thư mục chạy của phiên không có repo (mode none, chat, họp): `{data_dir}/work/{mã NV}/{tên}` — trống, CỐ ĐỊNH theo khoá job
 * (CLI tìm phiên để nối theo thư mục chạy → việc bị trả về phải chạy lại đúng thư mục cũ).
 */
export const workDir = (dataDir: string, agent: string, name: string) =>
  join(dataDir, 'work', agent, name.replace(/[^A-Za-z0-9._-]/g, '_'));

/** Thư mục tạm của một job: prompt, cấu hình MCP (xoá khi xong), output.log, activity.log. */
export const jobDir = (dataDir: string, jobId: number) => join(dataDir, 'jobs', String(jobId));

/**
 * File dự án nằm ở thư mục cha của `dir` (CLAUDE.md / AGENTS.md / .git): CLI chạy trong `dir` có thể nạp hướng dẫn của repo đó
 * → `doctor` cảnh báo cho mode none (thư mục chạy phải nằm ngoài mọi repo).
 */
export function projectFilesAbove(dir: string): string[] {
  const found: string[] = [];
  for (let d = dirname(dir); ; d = dirname(d)) {
    for (const f of ['CLAUDE.md', 'AGENTS.md', '.git']) if (existsSync(join(d, f))) found.push(join(d, f));
    if (dirname(d) === d) return found;
  }
}
