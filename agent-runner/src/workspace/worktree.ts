import { repoBaseBranches } from '../config';
import { errText, log } from '../log';
import { branchChanges, installHooks, mainBranchWarning, prepareWorktree, publish as pushAndOpenPr } from './git';
import type { Published, WorkspaceStrategy } from './strategy';

/**
 * Mode worktree (mặc định): mỗi việc một worktree + nhánh `agent/<nv>/<việc>`; sau phiên runner push nhánh và mở PR vào nhánh base.
 * Nhánh chạm `agent-runner/` → không push (hook pre-push cũng chặn).
 */
export const worktreeWorkspace: WorkspaceStrategy = {
  mode: 'worktree',
  noBuiltinTools: false,
  async prepare(c, job) {
    const { git, agent, config } = c;
    const fields = { job: job.id, agent: job.agent };
    const onMain = await mainBranchWarning(git, agent, agent.baseBranch);
    if (onMain) log('warn', 'repo đang ở main / master', { ...fields, task: job.label, message: onMain });
    // Hook có thể bị xoá sau lúc khởi động → trước mỗi job kiểm tra, thiếu thì tạo lại (hook khác của người dùng: không ghi đè, chỉ cảnh báo).
    for (const message of await installHooks(git, agent.repo, repoBaseBranches(config, agent.repo)))
      log('warn', 'hook git', { ...fields, message });
    const ws = await prepareWorktree(git, agent.repo, config.worktreesDir, job.agent, job.label, agent.baseBranch);
    if (ws.existing === 'origin')
      log('info', 'máy chưa có nhánh việc — lấy lại từ origin để làm tiếp', { ...fields, branch: ws.branch });

    const publish = async (title: string): Promise<Published> => {
      const ch = await branchChanges(git, ws.path, agent.baseBranch);
      const dirty = ch.dirty ? 'Còn thay đổi chưa commit trong worktree.' : '';
      const withDirty = (note: string) => [note, dirty].filter(Boolean).join(' ');
      if (ch.touchesProtected)
        return {
          note: withDirty(
            '⚠ Nhánh có thay đổi trong `agent-runner/` — runner KHÔNG push. Người thật kiểm tra worktree trên máy agent.',
          ),
          failure: 'Không push được',
        };
      if (ch.ahead === 0) return { note: withDirty('Phiên kết thúc, nhánh không có commit mới.') };
      const body = `Việc OfficeHub **${job.label}** — agent ${job.agent}, tạo tự động bởi agent-runner (TEST-44). Người thật review trước khi merge.`;
      try {
        const prUrl = await pushAndOpenPr(git, ws.path, ws.branch, agent.baseBranch, title, body);
        return { prUrl, note: dirty };
      } catch (e) {
        const error = errText(e);
        return {
          note: withDirty(`⚠ Không push / tạo được PR: ${error}`),
          failure: error.startsWith('git push lỗi') ? 'Không push được' : 'Không tạo được PR',
        };
      }
    };

    return { path: ws.path, branch: ws.branch, hasHistory: ws.reused || !!ws.existing, publish };
  },
};
