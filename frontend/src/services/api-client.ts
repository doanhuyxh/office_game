import type { IProblemDetails } from '@/types/api';

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

/** Mọi request gửi kèm cookie đăng nhập (cùng domain với API). */
export async function http<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const httpPost = <T>(url: string, body?: unknown) =>
  http<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
