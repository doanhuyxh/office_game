import type { IPageQuery, IProblemDetails } from '@/types/api';

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
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
  });
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

/** Chuỗi query phân trang: `page=2&pageSize=20`. */
export const pageQs = (q: IPageQuery) => `page=${q.page}&pageSize=${q.pageSize}`;
