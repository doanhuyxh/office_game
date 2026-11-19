import type { AgentConfig, RunnerConfig } from '../config';
import type { AgentState } from '../core/agent';
import type { Sessions } from '../core/session';
import { log } from '../log';
import type { Job, Store } from '../store';
import type { Wake } from '../validator';
import type { Git } from '../workspace';

/** Tin đánh thức của một loại job. */
export type WakeOf<K extends Wake['kind']> = Extract<Wake, { kind: K }>;

/**
 * Kết quả hỏi lại OfficeHub trước khi xếp hàng. Không nhận: `reason` ghi vào log; `warning` có giá trị = đây là tình huống đáng cảnh báo
 * (ghi mức warn với câu đó thay cho câu "bỏ qua …" thường lệ).
 */
export type Admission = { ok: true } | { ok: false; reason: string; warning?: string };

/** Câu log của khâu nhận tin, theo loại job. */
export interface IntakeText {
  skipped: string;
  checkFailed: string;
  queued: string;
  /** Khoá đã có job đang chờ / chạy. */
  merged: string;
}

/** Thứ handler dùng chung của runner. */
export interface JobServices {
  config: RunnerConfig;
  store: Store;
  sessions: Sessions;
  /** Git với HOME / PATH của agent. */
  gitFor(agent: AgentConfig): Git;
  /** Nhận một tin đánh thức như khi nó tới từ Telegram (handler dùng để xếp thêm một lượt sau phiên). */
  accept(s: AgentState, wake: Wake): Promise<number | null>;
}

/**
 * Một loại job (việc / chat / họp): tin đánh thức nào thành job, khoá và nhãn của job, hỏi lại OfficeHub trước khi xếp hàng, và cách chạy.
 * Thêm loại job mới = một file hiện thực interface này + một dòng trong registry `jobs/index.ts` (+ hình dạng tin ở `validator.ts`,
 * `JobKind` ở `store.ts`).
 */
export interface JobHandler<W extends Wake = Wake> {
  kind: W['kind'];
  text: IntakeText;
  /** Chạy được cả khi agent đang dự họp (mặc định job phải chờ hết cuộc họp). */
  runsDuringMeeting?: boolean;
  /** Khoá của job (`jobs.task_id`, cũng là khoá nối phiên) — một khoá chỉ một job đang chờ / chạy. */
  key(wake: W, agent: string): string;
  /** Nhãn trong log / cột `task_code`. */
  label(wake: W): string;
  projectId(wake: W): string;
  /** Hỏi lại OfficeHub bằng token của agent (lớp bảo vệ thật) — gọi lúc nhận tin. */
  admit(s: AgentState, wake: W): Promise<Admission>;
  /** Chạy job đã được lấy khỏi hàng đợi: kiểm tra lại → phiên CLI → ghi kết quả. */
  run(s: AgentState, job: Job, signal: AbortSignal): Promise<void>;
}

/** Kiểm tra lại ngay trước khi chạy không đạt → bỏ job (không chạy CLI). */
export function skipJob(store: Store, job: Job, reason: string) {
  store.finish(job.id, 'skipped', { reason });
  log('info', 'bỏ job', { job: job.id, reason });
}

/**
 * Khoá của job chat / họp: RIÊNG từng agent — nhiều bot cùng một hội thoại / cuộc họp mỗi bot một job, một phiên CLI
 * (job việc khoá theo id việc vì việc chỉ có một người làm).
 */
export const agentScopedKey = (agent: string, id: string) => `${agent}:${id}`;

/** Id hội thoại / phiên họp của job chat / họp (bỏ tiền tố agent của {@link agentScopedKey}). */
export const scopedId = (job: Pick<Job, 'key'>) => job.key.slice(job.key.indexOf(':') + 1);
