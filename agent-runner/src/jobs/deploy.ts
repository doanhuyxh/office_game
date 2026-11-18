import type { AgentState } from '../core/agent';
import { RunnerStopped, succeeded } from '../core/session';
import { deployPrompt } from '../prompt/deploy';
import type { Job } from '../store';
import { checkDeploy, type WakeData } from '../validator';
import { workspaces } from '../workspace';
import { agentScopedKey, type JobHandler, type JobServices, scopedId, skipJob, type WakeOf } from './handler';
import { presenceFailure, resultComment } from './task';

/**
 * Job deploy (TEST-168) — tin `task_done`: việc bot đang theo dõi vừa được người thật chuyển Xong. Hỏi lại OfficeHub (việc đã xong, bot còn
 * theo dõi) → thư mục trống của việc (mode none) → phiên CLI có shell làm theo mục "Deploy" của hướng dẫn → bình luận chi phí.
 * Chỉ agent `mode: none` + `builtin_tools: true` (không repo, có shell); agent khác → bỏ, bình luận lý do. Khoá riêng từng agent.
 */
export function deployJobs(services: JobServices): JobHandler<WakeOf<'deploy'>> {
  const { config, store, sessions } = services;

  async function work(s: AgentState, job: Job, signal: AbortSignal, desk: { task: string; failure?: string }) {
    const wake: WakeData = {
      employee_code: job.agent,
      project_id: job.project_id,
      task_id: scopedId(job),
      task_code: job.label,
    };
    const checked = checkDeploy(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
    if (!checked.ok) return skipJob(store, job, checked.reason);
    if (s.cfg.workspace.mode !== 'none' || !s.cfg.workspace.builtinTools) {
      const reason = 'bot deploy cần workspace mode none + builtin_tools: true';
      skipJob(store, job, reason);
      await s.hub.comment(wake.task_id, `**🤖 agent-runner** (${job.agent}) — KHÔNG deploy: ${reason}`);
      return;
    }
    const title = checked.value.title;
    s.presence.working(job.label, title);
    if (title.trim()) desk.task = `${job.label} · ${title.trim()}`;

    const ws = await workspaces.none.prepare({ config, agent: s.cfg, git: services.gitFor(s.cfg) }, job);
    // Mỗi lần deploy là một phiên mới (không nối phiên: lần trước có thể là deploy khác của cùng việc bị mở lại).
    const out = await sessions.run(s, job, signal, {
      cwd: ws.path,
      prompt: deployPrompt(wake),
      noBuiltinTools: false,
      presence: true,
      label: `${job.label} · deploy · ${title}`,
    });
    sessions.record(s, job, out, { cwd: ws.path, resumed: false });
    const ok = succeeded(out);
    if (!ok) desk.failure = presenceFailure(out);
    await s.hub.comment(wake.task_id, resultComment(job, out, undefined, 'Phiên deploy', ok, s.cfg.executor.model));
    sessions.finish(s, job, out, { note: 'Phiên deploy' });
  }

  return {
    kind: 'deploy',
    text: {
      skipped: 'bỏ qua deploy',
      checkFailed: 'không kiểm tra được việc cần deploy — bỏ qua',
      queued: 'xếp hàng deploy',
      merged: 'deploy việc này đã có job đang chờ / chạy',
    },
    key: (wake, agent) => agentScopedKey(agent, wake.task_id),
    label: (wake) => wake.task_code,
    projectId: (wake) => wake.project_id,

    async admit(s, wake) {
      return checkDeploy(await s.hub.getTask(wake.task_id), wake, s.employeeId!);
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
