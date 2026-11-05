import { ApiError } from '@/services/api-client';

/** Lỗi theo field từ ValidationProblem của ASP.NET (key camelCase). */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  return Object.fromEntries(Object.entries(err.problem.errors ?? {}).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), v.join(' ')]));
}

/** Thông điệp lỗi chung để hiện toast / dưới form. */
export function errorMessage(err: unknown, fallback = 'Có lỗi xảy ra, thử lại sau'): string {
  if (err instanceof ApiError) return err.status === 403 ? (err.problem.detail ?? 'Bạn không có quyền thực hiện thao tác này') : err.messages;
  return fallback;
}
