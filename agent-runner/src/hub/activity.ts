import type { ActivityEvent } from '../executor/events';
import { errText, log } from '../log';
import { FailureLog, failureKey, HubEndpoint, hubUrl, isTransient } from './endpoint';

/**
 * Gửi sự kiện "agent đang làm gì" lên OfficeHub để người đứng gần bot trong văn phòng 3D xem trực tiếp (TEST-99).
 * `POST <mcp_url>/activity` (cùng token AI của agent, chỉ tài khoản bot) `{ events: [...] }` → 204. Sự kiện đã che bí mật từ nơi tạo
 * (`executor/events.ts`); ở đây chỉ gom và gửi.
 * - Gom theo lô: gửi mỗi {@link ActivitySender.intervalMs} hoặc ngay khi đủ {@link ActivitySender.maxBatch} sự kiện; thân ≤
 *   {@link ActivitySender.maxBytes} (vượt → chia lô). Mỗi lúc một request (giữ thứ tự; máy chủ giới hạn 5 lần / giây / token).
 * - Hàng chờ tối đa {@link ActivitySender.maxQueue}; đầy → bỏ sự kiện cũ nhất (người xem trực tiếp cần cái mới nhất, không chặn job).
 * - Lỗi mạng / 5xx / 429 → thử lại lô đó 1 lần rồi bỏ; lỗi khác (400, 404…) → bỏ lô. Chỉ ghi log, không bao giờ ném lỗi ra job.
 * - 401 / 403 (token sai / tài khoản không phải bot) → ngừng gửi cho agent đó.
 * - KHÔNG BAO GIỜ nằm trên đường đi của job: runner chỉ gọi {@link push} / {@link flushNow} (không chờ, không ném lỗi). Job ghi kết quả +
 *   bình luận chi phí mà không đợi bộ gửi (lỗi 2026-11-14: `await drain()` cuối job lặp vô hạn → runner treo, không bình luận).
 * - {@link drain} (chờ tối đa {@link ActivitySender.drainMs}) chỉ dùng khi tiến trình sắp thoát (`cli run`), SAU khi job đã ghi xong.
 */
export class ActivitySender {
  static intervalMs = 1_000;
  static maxBatch = 50;
  /** Máy chủ nhận ≤ 256 KB — chừa lề cho khung JSON. */
  static maxBytes = 240 * 1024;
  static maxQueue = 500;
  static retryDelayMs = 500;
  static drainMs = 3_000;

  private queue: ActivityEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private sending?: Promise<void>;
  private disabled = false;
  private dropped = 0;
  private readonly endpoint: HubEndpoint;
  private readonly failures: FailureLog;

  constructor(
    mcpUrl: string,
    token: string,
    private readonly agent: string,
    private readonly enabled = true,
  ) {
    this.endpoint = new HubEndpoint(mcpUrl, 'activity', token);
    this.failures = new FailureLog(agent);
  }

  get url(): string {
    return this.endpoint.url;
  }

  /** Còn gửi không (cấu hình bật, chưa bị 401 / 403). */
  get active(): boolean {
    return this.enabled && !this.disabled;
  }
  get pending(): number {
    return this.queue.length;
  }

  /** Xếp một sự kiện vào hàng chờ. Không bao giờ ném lỗi (người xem trực tiếp không được làm hỏng job). */
  push(e: ActivityEvent) {
    try {
      if (!this.active) return;
      this.queue.push(e);
      if (this.queue.length > ActivitySender.maxQueue) {
        this.dropped += this.queue.length - ActivitySender.maxQueue;
        this.queue.splice(0, this.queue.length - ActivitySender.maxQueue);
      }
      if (this.queue.length >= ActivitySender.maxBatch) this.flushNow();
      else
        this.timer ??= setTimeout(() => {
          this.timer = undefined;
          this.kick();
        }, ActivitySender.intervalMs);
    } catch (err) {
      this.internalError('push', err);
    }
  }

  /** Gửi ngay hàng chờ, KHÔNG chờ kết quả, không ném lỗi — gọi ở cuối phiên để `session_end` đi liền thay vì đợi nhịp. */
  flushNow() {
    this.clearTimer();
    this.kick();
  }

  /** Khởi động một lượt gửi ở nền; lỗi bất ngờ chỉ ghi log (không để thành unhandled rejection làm sập runner). */
  private kick() {
    try {
      void this.flush().catch((err) => this.internalError('flush', err));
    } catch (err) {
      this.internalError('flush', err);
    }
  }

  /**
   * Chờ gửi nốt hàng chờ, tối đa `timeoutMs`, rồi bỏ phần còn lại. CHỈ dùng khi tiến trình sắp thoát và job đã ghi xong kết quả —
   * không gọi trên đường đi của job.
   */
  async drain(timeoutMs = ActivitySender.drainMs): Promise<void> {
    this.clearTimer();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Có hạn chót ngay trong vòng lặp: vòng `await` không tiến triển sẽ chiếm hết microtask, timer của Promise.race không bao giờ chạy
    // (lỗi 2026-11-14: runner treo 100% CPU ở cuối job, không ghi kết quả / không bình luận chi phí).
    const deadline = Date.now() + timeoutMs;
    const all = (async () => {
      while (this.active && (this.queue.length > 0 || this.sending) && Date.now() < deadline) await this.flush();
    })();
    await Promise.race([
      all,
      new Promise<void>((r) => {
        timeout = setTimeout(r, timeoutMs);
      }),
    ]);
    clearTimeout(timeout);
    this.queue = [];
  }

  stop() {
    this.clearTimer();
    this.queue = [];
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /**
   * Gửi lần lượt từng lô cho tới khi hết hàng chờ. Đang gửi → chờ lượt đang chạy (nó tự lấy tiếp hàng chờ). Không có gì để gửi → xong ngay,
   * KHÔNG ghi `sending` (trước đây lượt rỗng chạy xong đồng bộ rồi mới gán `sending` → cờ "đang gửi" kẹt mãi, `drain` lặp vô hạn).
   */
  private flush(): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.active || this.queue.length === 0) return Promise.resolve();
    // Hoãn một microtask: `sending` đã được gán trước khi `pump` chạy (và trước khi `finally` của nó xoá cờ).
    return (this.sending = Promise.resolve().then(() => this.pump()));
  }

  private async pump(): Promise<void> {
    try {
      while (this.active && this.queue.length > 0) await this.send(this.takeBatch());
    } finally {
      this.sending = undefined;
    }
  }

  /** Lấy ≤ maxBatch sự kiện đầu hàng chờ, tổng thân ≤ maxBytes (luôn lấy ít nhất 1). */
  private takeBatch(): ActivityEvent[] {
    let bytes = 0,
      n = 0;
    while (n < this.queue.length && n < ActivitySender.maxBatch) {
      const size = Buffer.byteLength(JSON.stringify(this.queue[n])) + 1;
      if (n > 0 && bytes + size > ActivitySender.maxBytes) break;
      bytes += size;
      n++;
    }
    return this.queue.splice(0, n);
  }

  /** Gửi một lô; lỗi mạng / 429 / 5xx → thử lại 1 lần rồi bỏ lô. */
  private async send(events: ActivityEvent[]): Promise<void> {
    let outcome = await this.endpoint.post({ events }, SEND_TIMEOUT_MS);
    if (outcome.status !== 'ok' && isTransient(outcome)) {
      await new Promise((r) => setTimeout(r, ActivitySender.retryDelayMs));
      outcome = await this.endpoint.post({ events }, SEND_TIMEOUT_MS);
    }
    if (outcome.status === 'ok') {
      this.failures.recovered('gửi hoạt động xem trực tiếp đã chạy lại');
      this.reportDropped();
      return;
    }
    if (outcome.status === 'denied') {
      this.disabled = true;
      this.queue = [];
      log(
        'warn',
        'OfficeHub không nhận hoạt động xem trực tiếp — ngừng gửi (tài khoản chưa được HR đánh dấu là bot?)',
        { agent: this.agent, status: outcome.code },
      );
      return;
    }
    const hint =
      outcome.status === 'missing'
        ? 'OfficeHub chưa có endpoint /mcp/activity — deploy bản mới + nginx chuyển tiếp'
        : 'gửi hoạt động xem trực tiếp lỗi — bỏ lô';
    this.failures.warn(failureKey(outcome), hint, { events: events.length });
  }

  private reportDropped() {
    if (!this.dropped) return;
    log('warn', 'hàng chờ hoạt động xem trực tiếp đầy — đã bỏ sự kiện cũ', {
      agent: this.agent,
      dropped: this.dropped,
    });
    this.dropped = 0;
  }

  /** Lỗi nội bộ của bộ gửi (không phải lỗi máy chủ) — chỉ ghi log, không bao giờ ném ra job. */
  private internalError(where: 'push' | 'flush', err: unknown) {
    this.failures.warn(where, `gửi hoạt động xem trực tiếp lỗi nội bộ: ${errText(err)}`, { events: 0 });
  }
}

/** Hạn gửi một lô. */
const SEND_TIMEOUT_MS = 5_000;

/** `http://host/mcp` → `http://host/mcp/activity`. */
export const activityUrl = (mcpUrl: string) => hubUrl(mcpUrl, 'activity');
