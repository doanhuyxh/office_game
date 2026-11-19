import { mkdirSync } from 'node:fs';
import { lightExecutor } from '../config';
import type { AgentState } from '../core/agent';
import { workDir } from '../core/paths';
import { errText, log } from '../log';
import { MEETING_RESUME_MAX, MEETING_TURN_MAX_MIN } from '../policy';
import { meetingPrompt } from '../prompt/meeting';
import { currentKind, type Job } from '../store';
import { checkMeeting } from '../validator';
import { agentScopedKey, type JobHandler, type JobServices, scopedId, skipJob, type WakeOf } from './handler';

/**
 * Job họp (TEST-84) — tin `meeting_turn` = MỘT lượt nói. Hỏi lại OfficeHub (đúng phiên, đang giữ lượt) → chạy CLI trong thư mục trống riêng
 * của cuộc họp, CHỈ tool MCP, tối đa {@link MEETING_TURN_MAX_MIN} phút (server tự chuyển lượt sau 3 phút) → agent tự `speak_in_meeting` /
 * `pass_turn`. Nối phiên theo cuộc họp, tối đa {@link MEETING_RESUME_MAX} lượt liên tiếp. Không bình luận vào việc, không báo trạng thái 3D
 * (bot đang được giữ ở phòng họp); chi phí vào `report`. Job họp được lấy trước job khác và chạy cả khi agent đang họp.
 *
 * Mỗi agent một phiên tại một thời điểm: agent đang chạy job VIỆC thì không dự họp được → runner bỏ lượt ngay (`pass_turn`) để cuộc họp
 * không đứng chờ hết hạn nói. Đang chạy job chat (ngắn) → xếp hàng, chạy ngay sau đó.
 */
export function meetingJobs(services: JobServices): JobHandler<WakeOf<'meeting'>> {
  const { config, store, sessions } = services;

  /**
   * Sau một lượt họp: agent còn giữ lượt của phiên đó không?
   * - Có tin meeting_turn mới tới giữa phiên (`rerun`) → đó là lượt MỚI → xếp thêm một job.
   * - Không → agent chưa dùng lượt vừa rồi (CLI lỗi / hết giờ / không nói) → bỏ lượt thay, cuộc họp đi tiếp ngay thay vì chờ hết hạn nói.
   */
  async function afterTurn(s: AgentState, job: Job) {
    const sessionId = scopedId(job);
    if (!checkMeeting(await s.hub.myMeeting(), sessionId).ok) return;
    const done = store.getJob(job.id);
    if (done?.rerun && done.status !== 'running') {
      await services.accept(s, {
        kind: 'meeting',
        employee_code: job.agent,
        session_id: sessionId,
        conversation_id: '',
      });
      return;
    }
    await s.hub.passTurn();
    log('warn', 'agent không dùng lượt họp — runner bỏ lượt thay', {
      job: job.id,
      agent: job.agent,
      task: job.label,
    });
  }

  return {
    kind: 'meeting',
    runsDuringMeeting: true,
    text: {
      skipped: 'bỏ qua lượt họp',
      checkFailed: 'không kiểm tra được cuộc họp — bỏ qua',
      queued: 'xếp hàng lượt họp',
      merged: 'cuộc họp đã có job đang chờ / chạy — gộp',
    },
    key: (wake, agent) => agentScopedKey(agent, wake.session_id),
    label: (wake) => `meeting:${wake.session_id.slice(0, 8)}`,
    projectId: () => '',

    async admit(s, wake) {
      const checked = checkMeeting(await s.hub.myMeeting(), wake.session_id);
      if (!checked.ok) return checked;
      const busy = store.runningJob(s.cfg.employeeCode);
      // Đang làm việc / bước theo dõi (phiên dài) → bỏ lượt; đang chat thì chờ được
      if (!busy || !['task', 'follow'].includes(currentKind(busy.kind))) return { ok: true };
      await s.hub.passTurn();
      return { ok: false, reason: `đang chạy ${busy.label}`, warning: 'agent đang làm việc — bỏ lượt họp' };
    },

    async run(s, job, signal) {
      const sessionId = scopedId(job);
      const checked = checkMeeting(await s.hub.myMeeting(), sessionId);
      if (!checked.ok) return skipJob(store, job, checked.reason);
      const cwd = workDir(config.dataDir, job.agent, `meeting-${sessionId}`);
      mkdirSync(cwd, { recursive: true });
      const resume = await sessions.resumeFor(s, job, cwd, MEETING_RESUME_MAX);
      const exec = {
        ...lightExecutor(s.cfg.executor),
        timeoutMin: Math.min(s.cfg.executor.timeoutMin, MEETING_TURN_MAX_MIN),
      };
      try {
        const out = await sessions.run(s, job, signal, {
          cwd,
          prompt: meetingPrompt(job.agent, sessionId, !!resume),
          resume,
          exec,
          noBuiltinTools: true,
          presence: false,
          label: 'Phát biểu trong cuộc họp',
        });
        sessions.record(s, job, out, { cwd, resumed: !!resume });
        sessions.finish(s, job, out);
      } finally {
        await afterTurn(s, job).catch((e) =>
          log('warn', 'không kiểm tra được lượt họp sau phiên', { job: job.id, agent: job.agent, error: errText(e) }),
        );
      }
    },
  };
}
