import type { AgentState } from '../core/agent';
import { RunnerStopped, succeeded } from '../core/session';
import type { TaskDetail } from '../hub/types';
import { errText, log } from '../log';
import { type FollowTools, followPrompt } from '../prompt/follow';
import type { Job } from '../store';
import { actedOnTask, checkFollow, type WakeData } from '../validator';
import { installHooks, prepareFollowWorktree, workspaces } from '../workspace';
import { agentScopedKey, type JobHandler, type JobServices, scopedId, skipJob, type WakeOf } from './handler';
import { presenceFailure, resultComment } from './task';

/**
 * Job `follow` (TEST-180) — tin `column_entered`: việc bot đang THEO DÕI vừa vào cột "Đánh thức bot theo dõi". Runner không biết bot phải làm gì
 * ở cột đó (review, deploy, đăng bài…): agent tự đọc hướng dẫn chức vụ + workGuide; cột không phải bước của mình thì dừng, không bình luận.
 *
 * Hỏi lại OfficeHub (còn theo dõi, việc còn ở cột đánh thức) → nơi chạy + công cụ theo cấu hình agent ({@link toolsOf}) → phiên CLI → bình
 * luận chi phí CHỈ khi agent đã để lại dấu vết trên việc hoặc phiên lỗi ({@link actedOnTask}); phiên tự dừng thì chỉ gửi mức dùng AI.
 * Khoá riêng từng agent (`<mã NV>:<id việc>`) — không đụng job việc của người làm. Thay job review (TEST-167) + deploy (TEST-168).
 */
export function followJobs(services: JobServices): JobHandler<WakeOf<'follow'>> {
  const { config, store, sessions } = services;

  async function work(s: AgentState, job: Job, signal: AbortSignal, desk: { task: string; failure?: string }) {
    const wake: WakeData = {
      employee_code: job.agent,
      project_id: job.project_id,
      task_id: scopedId(job),
      task_code: job.label,
    };
    const before = await s.hub.getTask(wake.task_id);
    const checked = checkFollow(before, wake, s.employeeId!);
    if (!checked.ok) return skipJob(store, job, checked.reason);
    const tools = toolsOf(s);
    if (!tools) {
      const reason = 'workspace in_place là thư mục làm việc thật của máy — bot theo dõi cần worktree hoặc none';
      skipJob(store, job, reason);
      await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy bước theo dõi: ${reason}`);
      return;
    }
    const title = checked.value.title;
    s.presence.working(job.label, title);
    if (title.trim()) desk.task = `${job.label} · ${title.trim()}`;

    const git = services.gitFor(s.cfg);
    let cwd: string;
    if (tools === 'repo') {
      for (const warning of await installHooks(git, s.cfg.repo, config.baseBranch))
        log('warn', warning, { agent: job.agent, task: job.label });
      try {
        cwd = await prepareFollowWorktree(
          git,
          s.cfg.repo,
          config.worktreesDir,
          job.agent,
          job.label,
          config.baseBranch,
        );
      } catch (e) {
        const reason = `không tạo được worktree: ${errText(e)}`;
        skipJob(store, job, reason);
        desk.failure = 'Không chạy được';
        await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy bước theo dõi: ${reason}`);
        return;
      }
    } else cwd = (await workspaces.none.prepare({ config, agent: s.cfg, git }, job)).path;

    const resume = await sessions.resumeFor(s, job, cwd);
    const out = await sessions.run(s, job, signal, {
      cwd,
      prompt: followPrompt(wake, { tools, baseBranch: config.baseBranch, resumed: !!resume }),
      resume,
      // repo: chỉ đọc (hook chặn mọi push); none không shell: chỉ tool MCP
      readOnly: tools === 'repo',
      noBuiltinTools: tools === 'mcp',
      presence: true,
      label: `${job.label} · theo dõi · ${title}`,
    });
    sessions.record(s, job, out, { cwd, resumed: !!resume });
    const ok = succeeded(out);
    if (!ok) desk.failure = presenceFailure(out);
    const note = NOTE[tools];
    if (!ok || (await acted(s, before, wake.task_id)))
      await s.hub.comment(wake.task_id, resultComment(job, out, undefined, note, ok, s.cfg.executor.model));
    else log('info', 'agent không có bước ở cột này — không bình luận chi phí', { job: job.id, task: job.label });
    sessions.finish(s, job, out, { note });
    // Việc vào cột đánh thức khác giữa phiên (tin mới → `rerun`) → hỏi lại và chạy thêm một lượt.
    if (store.getJob(job.id)?.rerun) await services.accept(s, { kind: 'follow', ...wake });
  }

  /** Agent có để lại bình luận / thao tác mới trên việc không (lỗi đọc → coi như có). */
  async function acted(s: AgentState, before: TaskDetail | undefined, taskId: string): Promise<boolean> {
    try {
      return actedOnTask(before, await s.hub.getTask(taskId), s.employeeName);
    } catch (e) {
      log('warn', 'không đọc lại được việc sau phiên — vẫn bình luận chi phí', { error: errText(e) });
      return true;
    }
  }

  return {
    kind: 'follow',
    text: {
      skipped: 'bỏ qua việc đang theo dõi',
      checkFailed: 'không kiểm tra được việc đang theo dõi — bỏ qua',
      queued: 'xếp hàng bước theo dõi',
      merged: 'việc đang theo dõi đã có job chờ / chạy',
    },
    key: (wake, agent) => agentScopedKey(agent, wake.task_id),
    label: (wake) => wake.task_code,
    projectId: (wake) => wake.project_id,

    async admit(s, wake) {
      return checkFollow(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
    },

    async run(s, job, signal) {
      const desk: { task: string; failure?: string } = { task: job.label };
      try {
        await work(s, job, signal, desk);
      } catch (e) {
        if (!(e instanceof RunnerStopped)) desk.failure = 'Runner lỗi';
        throw e;
      } finally {
        if (desk.failure)
          s.presence.error(desk.failure, { task: desk.task, taskId: scopedId(job), projectId: job.project_id });
        else s.presence.idle();
      }
    },
  };
}

/**
 * Công cụ của phiên follow theo cấu hình agent (không theo loại việc — loại việc nằm ở hướng dẫn):
 * worktree → repo chỉ đọc ở worktree tạm (review code…); none + builtin_tools → shell, không repo (deploy…); none → chỉ tool MCP (nghiệp vụ).
 * in_place → undefined: workspace thật của máy, không cho phiên của việc người khác chạy trong đó.
 */
export function toolsOf(s: Pick<AgentState, 'cfg'>): FollowTools | undefined {
  const w = s.cfg.workspace;
  if (w.mode === 'worktree') return 'repo';
  if (w.mode === 'none') return w.builtinTools ? 'shell' : 'mcp';
  return undefined;
}

const NOTE: Record<FollowTools, string> = {
  repo: 'Phiên theo dõi — repo chỉ đọc, không push',
  shell: 'Phiên theo dõi — có shell, không repo',
  mcp: 'Phiên theo dõi — chỉ tool MCP',
};
