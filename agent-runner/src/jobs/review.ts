import type { AgentState } from '../core/agent';
import { RunnerStopped, succeeded } from '../core/session';
import { log } from '../log';
import { reviewPrompt } from '../prompt/review';
import type { Job } from '../store';
import { checkReview, type WakeData } from '../validator';
import { installHooks, prepareReviewWorktree } from '../workspace';
import { agentScopedKey, type JobHandler, type JobServices, scopedId, skipJob, type WakeOf } from './handler';
import { presenceFailure, resultComment } from './task';

/**
 * Job review (TEST-167) — tin `review_requested`: bot là người review của việc vừa vào cột review. Hỏi lại OfficeHub (đúng người review, cột
 * review, chưa xong) → worktree tạm `REVIEW-{mã việc}` ở origin/{base} → phiên CLI chỉ đọc (agent tự checkout PR / nhánh của người làm,
 * build / test, MỘT bình luận REVIEW) → bình luận chi phí. Không publish; push bị hook chặn (`OFFICEHUB_READONLY`).
 * Khoá riêng từng agent (`<mã NV>:<id việc>`) — không đụng job việc của người làm. Chỉ agent mode worktree (cần repo + hook chặn push).
 */
export function reviewJobs(services: JobServices): JobHandler<WakeOf<'review'>> {
  const { config, store, sessions } = services;

  async function work(s: AgentState, job: Job, signal: AbortSignal, desk: { task: string; failure?: string }) {
    const wake: WakeData = {
      employee_code: job.agent,
      project_id: job.project_id,
      task_id: scopedId(job),
      task_code: job.label,
    };
    const checked = checkReview(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
    if (!checked.ok) return skipJob(store, job, checked.reason);
    if (s.cfg.workspace.mode !== 'worktree') {
      const reason = `bot review cần workspace worktree (đang ${s.cfg.workspace.mode})`;
      skipJob(store, job, reason);
      await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG review: ${reason}`);
      return;
    }
    const title = checked.value.title;
    s.presence.working(job.label, title);
    if (title.trim()) desk.task = `${job.label} · ${title.trim()}`;

    const git = services.gitFor(s.cfg);
    for (const warning of await installHooks(git, s.cfg.repo, config.baseBranch))
      log('warn', warning, { agent: job.agent, task: job.label });
    let cwd: string;
    try {
      cwd = await prepareReviewWorktree(git, s.cfg.repo, config.worktreesDir, job.agent, job.label, config.baseBranch);
    } catch (e) {
      const reason = `không tạo được worktree review: ${e instanceof Error ? e.message : String(e)}`;
      skipJob(store, job, reason);
      desk.failure = 'Không chạy được';
      await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG review: ${reason}`);
      return;
    }

    const resume = await sessions.resumeFor(s, job, cwd);
    const out = await sessions.run(s, job, signal, {
      cwd,
      prompt: reviewPrompt(wake, { baseBranch: config.baseBranch, resumed: !!resume }),
      resume,
      readOnly: true,
      presence: true,
      label: `${job.label} · review · ${title}`,
    });
    sessions.record(s, job, out, { cwd, resumed: !!resume });
    const ok = succeeded(out);
    if (!ok) desk.failure = presenceFailure(out);
    const note = 'Phiên review — chỉ đọc, không push';
    await s.hub.comment(wake.task_id, resultComment(job, out, undefined, note, ok, s.cfg.executor.model));
    sessions.finish(s, job, out, { note });
  }

  return {
    kind: 'review',
    text: {
      skipped: 'bỏ qua review',
      checkFailed: 'không kiểm tra được việc cần review — bỏ qua',
      queued: 'xếp hàng review',
      merged: 'review việc này đã có job đang chờ / chạy',
    },
    key: (wake, agent) => agentScopedKey(agent, wake.task_id),
    label: (wake) => wake.task_code,
    projectId: (wake) => wake.project_id,

    async admit(s, wake) {
      return checkReview(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
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
