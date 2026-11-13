import type { ActivityEvent } from './executor/events';
import { errText, log } from './log';

/**
 * Gửi sự kiện "agent đang làm gì" lên OfficeHub để người đứng gần bot trong văn phòng 3D xem trực tiếp (TEST-99).
 * `POST <mcp_url>/activity` (cùng token AI của agent, chỉ tài khoản bot) `{ events: [...] }` → 204. Sự kiện đã che bí mật từ nơi tạo
 * (`executor/events.ts`); ở đây chỉ gom và gửi.
 * - Gom theo lô: gửi mỗi {@link ActivitySender.intervalMs} hoặc ngay khi đủ {@link ActivitySender.maxBatch} sự kiện; thân ≤
 *   {@link ActivitySender.maxBytes} (vượt → chia lô). Mỗi lúc một request (giữ thứ tự; máy chủ giới hạn 5 lần / giây / token).
 * - Hàng chờ tối đa {@link ActivitySender.maxQueue}; đầy → bỏ sự kiện cũ nhất (người xem trực tiếp cần cái mới nhất, không chặn job).
 * - Lỗi mạng / 5xx / 429 → thử lại lô đó 1 lần rồi bỏ; lỗi khác (400, 404…) → bỏ lô. Chỉ ghi log, không bao giờ ném lỗi ra job.
 * - 401 / 403 (token sai / tài khoản không phải bot) → ngừng gửi cho agent đó.
 * - {@link drain} cuối job: gửi nốt hàng chờ, chờ tối đa {@link ActivitySender.drainMs}.
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
  private lastError?: string;
  private dropped = 0;
  readonly url: string;

  constructor(mcpUrl: string, private readonly token: string, private readonly agent: string, private readonly enabled = true) {
    this.url = activityUrl(mcpUrl);
  }

  /** Còn gửi không (cấu hình bật, chưa bị 401 / 403). */
  get active(): boolean { return this.enabled && !this.disabled; }
  get pending(): number { return this.queue.length; }

  push(e: ActivityEvent) {
    if (!this.active) return;
    this.queue.push(e);
    if (this.queue.length > ActivitySender.maxQueue) {
      this.dropped += this.queue.length - ActivitySender.maxQueue;
      this.queue.splice(0, this.queue.length - ActivitySender.maxQueue);
    }
    if (this.queue.length >= ActivitySender.maxBatch) { this.clearTimer(); void this.flush(); }
    else this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, ActivitySender.intervalMs);
  }

  /** Gửi nốt hàng chờ (cuối job); quá `timeoutMs` thì bỏ phần còn lại — không giữ job vì người xem. */
  async drain(timeoutMs = ActivitySender.drainMs): Promise<void> {
    this.clearTimer();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Có hạn chót ngay trong vòng lặp: vòng `await` không tiến triển sẽ chiếm hết microtask, timer của Promise.race không bao giờ chạy
    // (lỗi 2026-11-14: runner treo 100% CPU ở cuối job, không ghi kết quả / không bình luận chi phí).
    const deadline = Date.now() + timeoutMs;
    const all = (async () => { while (this.active && (this.queue.length > 0 || this.sending) && Date.now() < deadline) await this.flush(); })();
    await Promise.race([all, new Promise<void>((r) => { timeout = setTimeout(r, timeoutMs); })]);
    clearTimeout(timeout);
    this.queue = [];
  }

  stop() { this.clearTimer(); this.queue = []; }

  private clearTimer() { clearTimeout(this.timer); this.timer = undefined; }

  /**
   * Gửi lần lượt từng lô cho tới khi hết hàng chờ. Đang gửi → chờ lượt đang chạy (nó tự lấy tiếp hàng chờ). Không có gì để gửi → xong ngay,
   * KHÔNG ghi `sending` (trước đây lượt rỗng chạy xong đồng bộ rồi mới gán `sending` → cờ "đang gửi" kẹt mãi, `drain` lặp vô hạn).
   */
  private flush(): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.active || this.queue.length === 0) return Promise.resolve();
    // Hoãn một microtask: `sending` đã được gán trước khi `pump` chạy (và trước khi `finally` của nó xoá cờ).
    return this.sending = Promise.resolve().then(() => this.pump());
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
    let bytes = 0, n = 0;
    while (n < this.queue.length && n < ActivitySender.maxBatch) {
      const size = Buffer.byteLength(JSON.stringify(this.queue[n])) + 1;
      if (n > 0 && bytes + size > ActivitySender.maxBytes) break;
      bytes += size;
      n++;
    }
    return this.queue.splice(0, n);
  }

  private async send(events: ActivityEvent[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, ActivitySender.retryDelayMs));
      let status: number | undefined, error: string | undefined;
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ events }),
          signal: AbortSignal.timeout(5_000),
        });
        status = res.status;
      } catch (e) {
        error = errText(e);
      }
      if (status !== undefined && status >= 200 && status < 300) {
        if (this.lastError) { log('info', 'gửi hoạt động xem trực tiếp đã chạy lại', { agent: this.agent }); this.lastError = undefined; }
        if (this.dropped) { log('warn', 'hàng chờ hoạt động xem trực tiếp đầy — đã bỏ sự kiện cũ', { agent: this.agent, dropped: this.dropped }); this.dropped = 0; }
        return;
      }
      if (status === 401 || status === 403) {
        this.disabled = true;
        this.queue = [];
        log('warn', 'OfficeHub không nhận hoạt động xem trực tiếp — ngừng gửi (tài khoản chưa được HR đánh dấu là bot?)', { agent: this.agent, status });
        return;
      }
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt === 1) {
        const hint = status === 404 || status === 405
          ? 'OfficeHub chưa có endpoint /mcp/activity — deploy bản mới + nginx chuyển tiếp'
          : 'gửi hoạt động xem trực tiếp lỗi — bỏ lô';
        this.fail(status !== undefined ? `status=${status}` : error!, hint, events.length);
        return;
      }
    }
  }

  /** Lỗi giống lần trước → không ghi lại (mỗi giây một lô, không làm đầy log). */
  private fail(key: string, msg: string, count: number) {
    if (key === this.lastError) return;
    this.lastError = key;
    log('warn', msg, { agent: this.agent, error: key, events: count });
  }
}

/** `http://host/mcp` → `http://host/mcp/activity`. */
export function activityUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/+$/, '') + '/activity';
}
