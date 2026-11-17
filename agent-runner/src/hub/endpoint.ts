import { errText, log } from '../log';

/** `http://host/mcp` + `presence` → `http://host/mcp/presence`. */
export const hubUrl = (mcpUrl: string, path: string) => `${mcpUrl.replace(/\/+$/, '')}/${path}`;

/**
 * Kết quả một request tới endpoint phụ của OfficeHub (`/mcp/presence`, `/activity`, `/usage`, `/transcripts`), đã phân loại:
 * - `ok`      2xx.
 * - `invalid` 400 / 413 — dữ liệu sai / quá lớn; gửi lại y nguyên cũng vô ích.
 * - `denied`  401 / 403 — token sai / tài khoản không phải bot; nơi gọi ngừng gửi cho agent đó.
 * - `missing` 404 / 405 — máy chủ chưa có endpoint (chưa deploy bản mới / nginx chưa chuyển tiếp); thử lại sau.
 * - `error`   lỗi mạng (không có `code`) hoặc mã khác (429, 5xx…); thử lại sau.
 * `detail` = câu lỗi máy chủ trả (ProblemDetails) hoặc lỗi mạng.
 */
export type HubOutcome =
  | { status: 'ok'; response: Response }
  | { status: 'invalid' | 'denied' | 'missing'; code: number; detail: string }
  | { status: 'error'; code?: number; detail: string };

export type HubFailure = Exclude<HubOutcome, { status: 'ok' }>;

/** Khoá gộp log của một lần lỗi: `status=503`, hoặc câu lỗi mạng. */
export const failureKey = (o: HubFailure) => (o.code === undefined ? o.detail : `status=${o.code}`);

/** Lỗi đáng thử lại ngay: mạng, 429, 5xx. */
export const isTransient = (o: HubFailure) =>
  o.status === 'error' && (o.code === undefined || o.code === 429 || o.code >= 500);

/** Một endpoint phụ của OfficeHub, gọi bằng token AI của agent. Không bao giờ ném lỗi — mọi kết quả là {@link HubOutcome}. */
export class HubEndpoint {
  readonly url: string;

  constructor(
    mcpUrl: string,
    path: string,
    private readonly token: string,
  ) {
    this.url = hubUrl(mcpUrl, path);
  }

  post(body: unknown, timeoutMs: number): Promise<HubOutcome> {
    return this.request(this.url, timeoutMs, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  get(query: Record<string, string>, timeoutMs: number): Promise<HubOutcome> {
    const url = `${this.url}?${new URLSearchParams(query)}`;
    return this.request(url, timeoutMs, { headers: { authorization: `Bearer ${this.token}` } });
  }

  private async request(url: string, timeoutMs: number, init: RequestInit): Promise<HubOutcome> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { status: 'error', detail: errText(e) };
    }
    if (res.ok) return { status: 'ok', response: res };
    const code = res.status;
    const detail = await problemDetail(res);
    if (code === 400 || code === 413) return { status: 'invalid', code, detail };
    if (code === 401 || code === 403) return { status: 'denied', code, detail };
    if (code === 404 || code === 405) return { status: 'missing', code, detail };
    return { status: 'error', code, detail };
  }
}

/** Câu lỗi `detail` của ProblemDetails (máy chủ trả tiếng Việt); không phải JSON → đầu thân phản hồi; không đọc được → rỗng. */
async function problemDetail(res: Response): Promise<string> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return '';
  }
  try {
    const detail = JSON.parse(text)?.detail;
    if (typeof detail === 'string') return detail.slice(0, 300);
  } catch {
    /* không phải JSON */
  }
  return text.slice(0, 200);
}

/**
 * Log lỗi lặp của một bộ gửi: lỗi giống lần trước không ghi lại (nhịp gửi vài giây / phút không làm đầy log);
 * gửi được trở lại thì ghi một dòng "đã chạy lại".
 */
export class FailureLog {
  private last?: string;

  constructor(private readonly agent: string) {}

  warn(key: string, message: string, fields: Record<string, unknown> = {}) {
    if (key === this.last) return;
    this.last = key;
    log('warn', message, { agent: this.agent, error: key, ...fields });
  }

  /** Đang có lỗi → ghi `message` và xoá; không có lỗi → không làm gì. */
  recovered(message: string) {
    if (!this.last) return;
    this.last = undefined;
    log('info', message, { agent: this.agent });
  }

  clear() {
    this.last = undefined;
  }
}
