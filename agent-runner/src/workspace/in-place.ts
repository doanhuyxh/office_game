import { errText, log } from '../log';
import { inPlaceChanges, mainBranchWarning, prepareInPlace, pushInPlace, removeHooks } from './git';
import type { Published, WorkspaceStrategy } from './strategy';

/** Số commit liệt kê trong ghi chú kết quả. */
const COMMITS_SHOWN = 5;

/**
 * Mode in_place: agent làm ngay trong `repo`, commit vào nhánh đang checkout rồi runner push thẳng nhánh đó lên origin — KHÔNG PR, không hook.
 * Không push khi agent chạm `agent-runner/` hoặc tự đổi nhánh (người thật xem lại trên máy).
 */
export const inPlaceWorkspace: WorkspaceStrategy = {
  mode: 'in_place',
  noBuiltinTools: false,
  async prepare(c, job) {
    const { git, agent } = c;
    const fields = { job: job.id, agent: job.agent };
    const onMain = await mainBranchWarning(git, agent, agent.baseBranch);
    if (onMain) log('warn', 'repo đang ở main / master', { ...fields, task: job.label, message: onMain });
    // in_place không dùng hook → gỡ hook của runner nếu còn (hook của người dùng giữ nguyên).
    const removed = await removeHooks(git, agent.repo);
    if (removed.length) log('info', 'đã gỡ hook của runner (in_place không dùng)', { ...fields, hooks: removed });
    const start = await prepareInPlace(git, agent.repo, agent.baseBranch, agent.workspace.allowBaseBranch);

    const publish = async (): Promise<Published> => {
      const ch = await inPlaceChanges(git, start.path, start.head, start.branch);
      const blocked = ch.touchesProtected || ch.branchChanged;
      let note = 'Phiên kết thúc, không có commit mới.';
      let failure: string | undefined;
      if (ch.ahead > 0) {
        let pushed = 'CHƯA push';
        if (blocked) failure = 'Không push được';
        else {
          try {
            await pushInPlace(git, start.path, start.branch);
            pushed = 'đã push lên origin';
          } catch (e) {
            pushed = `⚠ CHƯA push — git push lỗi: ${errText(e).slice(0, 300)}`;
            failure = 'Không push được';
          }
        }
        const commits = ch.commits.slice(0, COMMITS_SHOWN).map((c) => `\`${c}\``);
        const more = ch.ahead > COMMITS_SHOWN ? ', …' : '';
        note = `${ch.ahead} commit mới trên nhánh \`${ch.branchNow || start.branch}\` (${pushed}): ${commits.join(', ')}${more}`;
      }
      if (ch.touchesProtected)
        note +=
          ' ⚠ Có thay đổi trong `agent-runner/` — runner KHÔNG push; người thật xem lại / bỏ commit đó rồi tự push.';
      if (ch.branchChanged)
        note += ` ⚠ Agent đã đổi nhánh (${start.branch} → ${ch.branchNow || 'detached HEAD'}) trái quy tắc — runner KHÔNG push, kiểm tra repo.`;
      if (ch.dirty) note += ' Còn thay đổi chưa commit trong workspace.';
      return { note, failure };
    };

    return { path: start.path, branch: start.branch, hasHistory: false, publish };
  },
};
