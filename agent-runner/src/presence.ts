import { errText, log } from './log';

/**
 * Báo OfficeHub "bot đang làm / rảnh" để hiện trong văn phòng 3D (2026-11-13): đang làm → ngồi bàn, bong bóng "🛠 WEB-12 · Sửa code";
 * rảnh → ra Khu nghỉ. POST `<mcp_url>/presence` (cùng token AI, chỉ tài khoản bot) `{ state, task?, activity? }`.
 * - Gộp: tối đa 1 lần / {@link PresenceReporter.minGapMs} (gửi trạng thái mới nhất); nhịp "còn sống" mỗi {@link PresenceReporter.heartbeatMs}
 *   (OfficeHub coi bot offline sau 5 phút im lặng).
 * - Chỉ gửi nhãn thô ({@link activityLabel}) — không gửi lệnh bash, đường dẫn file hay lời agent (cả công ty thấy bong bóng).
 * - Lỗi chỉ ghi log, không bao giờ làm hỏng job. 401 / 403 (không phải tài khoản bot / token sai) → ngừng báo cho agent đó.
 */
export type PresenceState = { state: 'working'; task: string; activity?: string } | { state: 'idle' };

export class PresenceReporter {
  static minGapMs = 10_000;
  static heartbeatMs = 120_000;
  private current: PresenceState = { state: 'idle' };
  private lastSent = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private beat?: ReturnType<typeof setInterval>;
  private disabled = false;
  private sending = false;
  readonly url: string;

  constructor(mcpUrl: string, private readonly token: string, private readonly agent: string) {
    this.url = presenceUrl(mcpUrl);
  }

  /** Bắt đầu: báo rảnh + nhịp còn sống. */
  start() {
    if (this.beat) return;
    this.beat = setInterval(() => void this.flush(), PresenceReporter.heartbeatMs);
    this.set({ state: 'idle' }, true);
  }

  stop() {
    clearInterval(this.beat);
    clearTimeout(this.timer);
    this.beat = this.timer = undefined;
  }

  /** Bắt đầu job: "WEB-12 · Tên việc" — gửi ngay. */
  working(code: string, title?: string) {
    const task = title?.trim() ? `${code} · ${title.trim()}` : code;
    this.set({ state: 'working', task }, true);
  }

  /** Thao tác của agent (câu từ `describeBlock`) → nhãn thô, gộp theo nhịp. */
  activity(action: string) {
    if (this.current.state !== 'working') return;
    const label = activityLabel(action);
    if (!label || label === this.current.activity) return;
    this.set({ ...this.current, activity: label }, false);
  }

  /** Hết job → rảnh, gửi ngay. */
  idle() {
    this.set({ state: 'idle' }, true);
  }

  get state(): PresenceState { return this.current; }

  private set(s: PresenceState, now: boolean) {
    this.current = s;
    const wait = now ? 0 : Math.max(0, this.lastSent + PresenceReporter.minGapMs - Date.now());
    if (wait === 0) { clearTimeout(this.timer); this.timer = undefined; void this.flush(); }
    else this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, wait);
  }

  private async flush() {
    if (this.disabled) return;
    if (this.sending) { this.timer ??= setTimeout(() => { this.timer = undefined; void this.flush(); }, 500); return; }
    this.sending = true;
    this.lastSent = Date.now();
    const body = this.current;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401 || res.status === 403) {
        this.disabled = true;
        log('warn', 'OfficeHub không nhận trạng thái văn phòng 3D — ngừng báo (tài khoản chưa được HR đánh dấu là bot?)', { agent: this.agent, status: res.status });
      } else if (res.status === 404 || res.status === 405) {
        // Máy chủ chưa có /mcp/presence (OfficeHub chưa deploy bản mới / reverse proxy chưa chuyển tiếp) — vẫn thử theo nhịp, tự chạy lại khi có
        this.fail(`status=${res.status}`, 'OfficeHub chưa có endpoint trạng thái văn phòng 3D — deploy bản mới + nginx `location = /mcp/presence`; runner vẫn thử lại theo nhịp');
      } else if (!res.ok) this.fail(`status=${res.status}`, 'báo trạng thái văn phòng 3D lỗi');
      else if (this.lastError) { log('info', 'báo trạng thái văn phòng 3D đã chạy lại', { agent: this.agent }); this.lastError = undefined; }
    } catch (e) {
      this.fail(errText(e), 'báo trạng thái văn phòng 3D lỗi');
    } finally {
      this.sending = false;
    }
  }

  /** Lỗi giống lần trước → không ghi lại (nhịp còn sống 2 phút không làm đầy log). */
  private lastError?: string;
  private fail(key: string, msg: string) {
    if (key === this.lastError) return;
    this.lastError = key;
    log('warn', msg, { agent: this.agent, error: key });
  }
}

/** `http://host/mcp` → `http://host/mcp/presence`. */
export function presenceUrl(mcpUrl: string): string {
  return mcpUrl.replace(/\/+$/, '') + '/presence';
}

/**
 * Câu mô tả thao tác (adapter claude: "Đọc src/x.ts", "Chạy: bun test", "Nói: …") → nhãn thô cho bong bóng 3D.
 * undefined = không đổi nhãn (dòng model, dòng lạ).
 */
export function activityLabel(action: string): string | undefined {
  const a = action.trim();
  if (a.startsWith('Đọc ')) return 'Đọc code';
  if (a.startsWith('Sửa ') || a.startsWith('Ghi ')) return 'Sửa code';
  if (a.startsWith('Chạy:')) {
    const cmd = a.slice(5).toLowerCase();
    if (/\b(test|vitest|jest|pytest)\b/.test(cmd)) return 'Chạy kiểm thử';
    if (/\b(build|typecheck|tsc|lint)\b/.test(cmd)) return 'Build / kiểm tra';
    if (/\bgit\b/.test(cmd)) return 'Thao tác git';
    return 'Chạy lệnh';
  }
  if (a.startsWith('Tìm:')) return 'Tìm trong code';
  if (a.startsWith('Nói:')) return 'Suy nghĩ';
  if (a.startsWith('Cập nhật danh sách việc')) return 'Lên kế hoạch';
  if (a.startsWith('Giao việc phụ')) return 'Giao việc phụ';
  if (a.startsWith('OfficeHub ')) return 'Cập nhật OfficeHub';
  if (a.startsWith('Dùng ')) return 'Làm việc';
  return "Không rõ thao tác"; // dòng model, dòng lạ → không đổi nhãn
}
