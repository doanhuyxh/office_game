import { mkdirSync } from 'node:fs';
import { lightExecutor } from '../config';
import type { AgentState } from '../core/agent';
import { workDir } from '../core/paths';
import { chatPrompt } from '../prompt/chat';
import type { Job } from '../store';
import { checkChat } from '../validator';
import { agentScopedKey, type JobHandler, type JobServices, scopedId, skipJob, type WakeOf } from './handler';

/**
 * Job chat (TEST-81) — tin `chat_mention`: người thật @nhắc bot trong một hội thoại. Hỏi lại OfficeHub (hội thoại còn tin @nhắc agent chưa đọc)
 * → chạy CLI trong thư mục trống riêng của hội thoại, CHỈ tool MCP (tin nhắn là nội dung người khác viết) → agent tự đọc / trả lời / đánh
 * dấu đã đọc. Dùng `executor.light`. Nối phiên theo hội thoại khi lần trước còn trong ngưỡng (TEST-142). Không bình luận vào việc, không
 * báo trạng thái 3D; chi phí vẫn vào `report`.
 * Hội thoại đang có job chờ → gộp (job đó đọc cả tin mới); đang chạy → `rerun`, xong thì chạy thêm một lượt.
 */
export function chatJobs(services: JobServices): JobHandler<WakeOf<'chat'>> {
  const { config, store, sessions } = services;
  return {
    kind: 'chat',
    text: {
      skipped: 'bỏ qua tin nhắc',
      checkFailed: 'không kiểm tra được hội thoại — bỏ qua',
      queued: 'xếp hàng tin nhắc',
      merged: 'hội thoại đã có job đang chờ / chạy — gộp',
    },
    key: (wake, agent) => agentScopedKey(agent, wake.conversation_id),
    label: (wake) => `chat:${wake.conversation_id.slice(0, 8)}`,
    projectId: () => '',

    async admit(s, wake) {
      return checkChat(await s.hub.listChats(), wake.conversation_id);
    },

    async run(s: AgentState, job: Job, signal: AbortSignal) {
      const conversationId = scopedId(job);
      const checked = checkChat(await s.hub.listChats(), conversationId);
      if (!checked.ok) return skipJob(store, job, checked.reason);
      const cwd = workDir(config.dataDir, job.agent, `chat-${conversationId}`);
      mkdirSync(cwd, { recursive: true });
      const resume = await sessions.resumeFor(s, job, cwd);
      const out = await sessions.run(s, job, signal, {
        cwd,
        prompt: chatPrompt(job.agent, checked.value.conversation, !!resume),
        resume,
        exec: lightExecutor(s.cfg.executor),
        noBuiltinTools: true,
        presence: false,
        label: 'Trả lời tin nhắn',
      });
      sessions.record(s, job, out, { cwd, resumed: !!resume });
      sessions.finish(s, job, out);
      // Có tin nhắc mới tới giữa phiên → kiểm tra lại (đã đọc hết thì tự bỏ) và chạy thêm một lượt.
      if (store.getJob(job.id)?.rerun)
        await services.accept(s, {
          kind: 'chat',
          employee_code: job.agent,
          conversation_id: conversationId,
          message_id: '',
        });
    },
  };
}
