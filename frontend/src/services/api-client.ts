import type { IPageQuery, IProblemDetails } from '@/types/api';
import { isGatewayDown, maintenance } from '@/services/maintenance';

export class ApiError extends Error {
  constructor(
    public status: number,
    public problem: IProblemDetails = {},
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }

  /** Gom lỗi validation (ValidationProblem) thành một chuỗi để hiển thị. */
  get messages(): string {
    const errs = Object.values(this.problem.errors ?? {}).flat();
    return errs.length ? errs.join(' ') : this.message;
  }
}

/** Mọi request gửi kèm cookie đăng nhập (cùng domain với API). Body FormData (upload file) → để trình duyệt tự đặt Content-Type + boundary. */
export async function http<T>(url: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
    });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) maintenance.networkError();
    throw err;
  }
  // API tắt / đang khởi động lại (proxy trả 502 / 503 / 504) → trang bảo trì chung (services/maintenance.ts)
  if (isGatewayDown(res)) maintenance.gatewayDown();
  else maintenance.ok();
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const httpPost = <T>(url: string, body?: unknown) =>
  http<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/** Upload một file (multipart, field "file"). */
export const httpUpload = <T>(url: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return http<T>(url, { method: 'POST', body: form });
};

/** Tên file trong `Content-Disposition` (ưu tiên `filename*=UTF-8''…`); không có → null. */
function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* rơi xuống filename= */ } }
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(header);
  return plain ? plain[2].trim() : null;
}

/**
 * Tải file (GET, cookie) thành Blob rồi lưu về máy — dùng khi cần biết lỗi (404, 403…) để toast thay vì mở trang lỗi của trình duyệt.
 * Lỗi HTTP → `ApiError` như `http`. `fallbackName` khi server không gửi tên file.
 */
export async function httpDownload(url: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (err) {
    maintenance.networkError();
    throw err;
  }
  if (isGatewayDown(res)) maintenance.gatewayDown();
  else maintenance.ok();
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = dispositionName(res.headers.get('Content-Disposition')) ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/**
 * GET (cookie) trả về `Response` còn nguyên luồng `body` — dùng khi cần đọc theo luồng (vd giải nén transcript ngay trên trình duyệt, TEST-197).
 * Lỗi HTTP → `ApiError` như `http`; huỷ bằng `signal` → `AbortError`.
 */
export async function httpStream(url: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include', signal });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) maintenance.networkError();
    throw err;
  }
  if (isGatewayDown(res)) maintenance.gatewayDown();
  else maintenance.ok();
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return res;
}

/** Chuỗi query phân trang: `page=2&pageSize=20`. */
export const pageQs = (q: IPageQuery) => `page=${q.page}&pageSize=${q.pageSize}`;
