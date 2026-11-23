import { repoBaseBranches, type WorkspaceConfig, workspaceFor } from '../config';
import type { AgentState } from '../core/agent';
import { RunnerStopped, succeeded } from '../core/session';
import type { TaskDetail } from '../hub/types';
import { errText, log } from '../log';
import { type FollowTools, followPrompt } from '../prompt/follow';
import type { Job } from '../store';
import { actedOnTask, checkFollow, commitRefs, type WakeData } from '../validator';
import { commitsMissingOnOrigin, type Git, installHooks, prepareFollowWorktree, workspaces } from '../workspace';
import {
  agentScopedKey,
  type JobHandler,
  type JobServices,
  noWorkspaceReason,
  scopedId,
  skipJob,
  type WakeOf,
} from './handler';
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
    let before = await s.hub.getTask(wake.task_id);
    let checked = checkFollow(before, wake, s.employeeId!);
    if (!checked.ok) return skipJob(store, job, checked.reason);
    // TEST-200: nơi chạy + công cụ theo DỰ ÁN của việc; dự án chưa gắn repo trên máy này → bỏ (lúc nhận tin đã lọc, đây là lần kiểm tra lại).
    const place = workspaceFor(s.cfg, job.project_id);
    if (!place) return skipJob(store, job, noWorkspaceReason(s.cfg, job));
    const tools = toolsOf(place.workspace);
    if (!tools) {
      const reason = 'workspace in_place là thư mục làm việc thật của máy — bot theo dõi cần worktree hoặc none';
      skipJob(store, job, reason);
      await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy bước theo dõi: ${reason}`);
      return;
    }
    const title = checked.value.title;
    s.presence.working(job.label, title);
    if (title.trim()) desk.task = `${job.label} · ${title.trim()}`;

    const git = services.gitFor(s.cfg, place);
    let cwd: string;
    if (tools === 'repo') {
      for (const warning of await installHooks(git, place.repo, repoBaseBranches(config, place.repo)))
        log('warn', warning, { agent: job.agent, task: job.label });
      // TEST-225: người làm đổi cột trong phiên, runner của họ push sau phiên → chờ commit ghi trong bình luận có trên origin.
      if (await awaitCommits(s, job, git, place.repo, before, signal)) {
        // Đã chờ → việc có thể đã sang cột khác / agent bị bỏ theo dõi: hỏi lại như lúc bắt đầu.
        before = await s.hub.getTask(wake.task_id);
        checked = checkFollow(before, wake, s.employeeId!);
        if (!checked.ok) return skipJob(store, job, checked.reason);
      }
      try {
        cwd = await prepareFollowWorktree(git, place.repo, config.worktreesDir, job.agent, job.label, place.baseBranch);
      } catch (e) {
        const reason = `không tạo được worktree: ${errText(e)}`;
        skipJob(store, job, reason);
        desk.failure = 'Không chạy được';
        await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG chạy bước theo dõi: ${reason}`);
        return;
      }
    } else cwd = (await workspaces.none.prepare({ config, agent: s.cfg, place, git }, job)).path;

    const resume = await sessions.resumeFor(s, job, cwd);
    const out = await sessions.run(s, job, signal, {
      cwd,
      prompt: followPrompt(wake, { tools, baseBranch: place.baseBranch, resumed: !!resume }),
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

  /**
   * Chờ các commit ghi trong bình luận của việc ({@link commitRefs}) có trên origin: fetch lại theo nhịp, tới trần thì thôi (người làm chưa push
   * được, hoặc chuỗi đó không phải commit) — bước theo dõi vẫn chạy và agent báo theo hướng dẫn. Trả true nếu đã phải chờ.
   * Fetch lỗi → không chờ (khâu tạo worktree ngay sau sẽ báo lỗi đó lên việc). Runner dừng lúc đang chờ → {@link RunnerStopped}.
   */
  async function awaitCommits(
    s: AgentState,
    job: Job,
    git: Git,
    repo: string,
    detail: TaskDetail | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    let missing = commitRefs(detail, s.employeeName);
    if (!missing.length) return false;
    const { pollMs, maxMs } = services.commitWait();
    const deadline = Date.now() + maxMs;
    const ctx = { job: job.id, agent: job.agent, task: job.label };
    let waited = false;
    for (;;) {
      try {
        missing = await commitsMissingOnOrigin(git, repo, missing);
      } catch (e) {
        log('warn', 'không fetch được origin để kiểm tra commit — không chờ', { ...ctx, error: errText(e) });
        return waited;
      }
      if (!missing.length) {
        if (waited) log('info', 'commit trong bình luận đã có trên origin — chạy bước theo dõi', ctx);
        return waited;
      }
      if (Date.now() + pollMs > deadline) break;
      if (!waited)
        log('info', 'commit trong bình luận chưa có trên origin — chờ người làm push', {
          ...ctx,
          commits: missing.join(', '),
          maxSec: Math.round(maxMs / 1000),
        });
      waited = true;
      await pause(pollMs, signal);
    }
    log('warn', 'hết thời gian chờ, commit trong bình luận vẫn chưa có trên origin — vẫn chạy bước theo dõi', {
      ...ctx,
      commits: missing.join(', '),
    });
    return waited;
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
      const checked = checkFollow(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
      if (!checked.ok) return checked;
      // TEST-200: dự án chưa gắn repo trên máy này → không xếp hàng (bot theo dõi không bình luận lên việc không có bước của mình).
      if (!workspaceFor(s.cfg, wake.project_id))
        return {
          ok: false,
          reason: noWorkspaceReason(s.cfg, { project_id: wake.project_id, label: wake.task_code }),
          warning: 'bỏ qua việc đang theo dõi — dự án chưa gắn repo',
        };
      return checked;
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

/** Ngủ `ms`; runner dừng (signal) → ném {@link RunnerStopped} ngay để job về hàng đợi. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new RunnerStopped());
    const stop = () => {
      clearTimeout(timer);
      reject(new RunnerStopped());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Công cụ của phiên follow theo `workspace` của agent cho dự án của việc (không theo loại việc — loại việc nằm ở hướng dẫn):
 * worktree → repo chỉ đọc ở worktree tạm (review code…); none + builtin_tools → shell, không repo (deploy…); none → chỉ tool MCP (nghiệp vụ).
 * in_place → undefined: workspace thật của máy, không cho phiên của việc người khác chạy trong đó.
 */
export function toolsOf(w: Pick<WorkspaceConfig, 'mode' | 'builtinTools'>): FollowTools | undefined {
  if (w.mode === 'worktree') return 'repo';
  if (w.mode === 'none') return w.builtinTools ? 'shell' : 'mcp';
  return undefined;
}

const NOTE: Record<FollowTools, string> = {
  repo: 'Phiên theo dõi — repo chỉ đọc, không push',
  shell: 'Phiên theo dõi — có shell, không repo',
  mcp: 'Phiên theo dõi — chỉ tool MCP',
};
