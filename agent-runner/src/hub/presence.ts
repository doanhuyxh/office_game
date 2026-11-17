import { log } from '../log';
import { FailureLog, failureKey, HubEndpoint, type HubOutcome, hubUrl } from './endpoint';

/**
 * Báo OfficeHub "bot đang làm / rảnh" để hiện trong văn phòng 3D (2026-11-13): đang làm → ngồi bàn, bong bóng "🛠 WEB-12 · Sửa code";
 * rảnh → ra Khu nghỉ. POST `<mcp_url>/presence` (cùng token AI, chỉ tài khoản bot) `{ state, task?, activity? }`.
 * - Gộp: tối đa 1 lần / {@link PresenceReporter.minGapMs} (gửi trạng thái mới nhất); nhịp "còn sống" mỗi {@link PresenceReporter.heartbeatMs}
 *   (OfficeHub coi bot offline sau 5 phút im lặng).
 * - Chỉ gửi nhãn thô ({@link activityLabel}) — không gửi lệnh bash, đường dẫn file hay lời agent (cả công ty thấy bong bóng).
 * - Job việc hỏng (TEST-121) → `error` kèm loại lỗi ngắn ("Hết giờ", "Không push được"…) — bot ngồi bàn, bong bóng ⚠. Lỗi giữ qua nhịp còn sống
 *   cho tới job kế ({@link PresenceReporter.working}) hoặc runner khởi động lại ({@link PresenceReporter.start}); `idle()` không xoá lỗi.
 *   Máy chủ bản cũ trả 400 cho `error` → ghi log một lần, gửi `idle` thay.
 * - Lỗi chỉ ghi log, không bao giờ làm hỏng job. 401 / 403 (không phải tài khoản bot / token sai) → ngừng báo cho agent đó.
 */
export type PresenceState =
  | { state: 'working'; task: string; activity?: string }
  | { state: 'idle' }
  | { state: 'error'; task?: string; error: string; taskId?: string; projectId?: string };

/** Độ dài tối đa của loại lỗi gửi lên (cả công ty thấy — chỉ nhãn ngắn, không lệnh / đường dẫn / stderr). */
export const PRESENCE_ERROR_MAX = 40;

export class PresenceReporter {
  static minGapMs = 10_000;
  static heartbeatMs = 120_000;
  private current: PresenceState = { state: 'idle' };
  private lastSent = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private beat?: ReturnType<typeof setInterval>;
  private disabled = false;
  private errorUnsupportedLogged = false;
  private sending = false;
  private readonly endpoint: HubEndpoint;
  private readonly failures: FailureLog;

  constructor(
    mcpUrl: string,
    token: string,
    private readonly agent: string,
  ) {
    this.endpoint = new HubEndpoint(mcpUrl, 'presence', token);
    this.failures = new FailureLog(agent);
  }

  get url(): string {
    return this.endpoint.url;
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

  /** Hết job → rảnh, gửi ngay. Đang báo lỗi → giữ lỗi (`finally` của job không xoá). */
  idle() {
    if (this.current.state === 'error') return;
    this.set({ state: 'idle' }, true);
  }

  /** Job việc hỏng → báo lỗi ngay; `error` = loại lỗi ngắn (cắt {@link PRESENCE_ERROR_MAX} ký tự). */
  error(error: string, ref: { task?: string; taskId?: string; projectId?: string } = {}) {
    const s: PresenceState = { state: 'error', error: error.trim().slice(0, PRESENCE_ERROR_MAX) };
    if (ref.task?.trim()) s.task = ref.task.trim();
    if (ref.taskId) s.taskId = ref.taskId;
    if (ref.projectId) s.projectId = ref.projectId;
    this.set(s, true);
  }

  /** Bỏ trạng thái lỗi → rảnh (không đang lỗi thì không làm gì). */
  clearError() {
    if (this.current.state === 'error') this.set({ state: 'idle' }, true);
  }

  get state(): PresenceState {
    return this.current;
  }

  private set(s: PresenceState, now: boolean) {
    this.current = s;
    const wait = now ? 0 : Math.max(0, this.lastSent + PresenceReporter.minGapMs - Date.now());
    if (wait === 0) {
      clearTimeout(this.timer);
      this.timer = undefined;
      void this.flush();
    } else
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, wait);
  }

  private async flush() {
    if (this.disabled) return;
    if (this.sending) {
      this.timer ??= setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 500);
      return;
    }
    this.sending = true;
    this.lastSent = Date.now();
    const sent = this.current;
    let outcome: HubOutcome;
    try {
      outcome = await this.endpoint.post(sent, SEND_TIMEOUT_MS);
    } finally {
      this.sending = false;
    }
    if (this.handle(outcome, sent)) await this.flush();
  }

  /** Xử lý kết quả gửi. Trả true = gửi lại ngay (vừa đổi `error` → `idle` cho máy chủ bản cũ). */
  private handle(outcome: HubOutcome, sent: PresenceState): boolean {
    if (outcome.status === 'ok') {
      this.failures.recovered('báo trạng thái văn phòng 3D đã chạy lại');
      return false;
    }
    if (outcome.status === 'denied') {
      this.disabled = true;
      log(
        'warn',
        'OfficeHub không nhận trạng thái văn phòng 3D — ngừng báo (tài khoản chưa được HR đánh dấu là bot?)',
        { agent: this.agent, status: outcome.code },
      );
      return false;
    }
    if (outcome.status === 'missing') {
      // OfficeHub chưa deploy bản mới / reverse proxy chưa chuyển tiếp — vẫn thử theo nhịp, tự chạy lại khi có
      this.failures.warn(
        failureKey(outcome),
        'OfficeHub chưa có endpoint trạng thái văn phòng 3D — deploy bản mới + nginx `location = /mcp/presence`; runner vẫn thử lại theo nhịp',
      );
      return false;
    }
    if (outcome.code === 400 && sent.state === 'error') return this.fallBackToIdle(sent);
    this.failures.warn(failureKey(outcome), 'báo trạng thái văn phòng 3D lỗi');
    return false;
  }

  /** Máy chủ chưa nhận state "error" (bản trước TEST-118) → báo rảnh thay, không tắt báo trạng thái. Trả true = cần gửi `idle`. */
  private fallBackToIdle(rejected: PresenceState): boolean {
    if (!this.errorUnsupportedLogged) {
      this.errorUnsupportedLogged = true;
      log('warn', 'OfficeHub chưa nhận trạng thái lỗi của văn phòng 3D — báo rảnh thay (deploy bản mới để hiện ⚠)', {
        agent: this.agent,
      });
    }
    if (this.current !== rejected) return false; // đã có trạng thái mới hơn, lượt gửi kế lo
    this.current = { state: 'idle' };
    return true;
  }
}

/** Hạn một lần báo trạng thái. */
const SEND_TIMEOUT_MS = 10_000;

/** `http://host/mcp` → `http://host/mcp/presence`. */
export const presenceUrl = (mcpUrl: string) => hubUrl(mcpUrl, 'presence');

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
  return undefined; // dòng model, dòng lạ → không đổi nhãn
}
