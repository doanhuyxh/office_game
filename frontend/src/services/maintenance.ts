import { useSyncExternalStore } from 'react';

/**
 * Trạng thái chung "API không phản hồi" (TEST-67): `http()` trong api-client báo vào đây, App hiện trang bảo trì phủ toàn màn hình
 * (không để từng màn tự xử lý). Trang bảo trì tự gọi `/health` định kỳ; API trả lời lại → tắt và tải lại dữ liệu.
 * - 502 / 503 / 504 do proxy (nginx) trả — thân KHÔNG phải JSON. API tự trả 502 / 503 kèm ProblemDetails (vd gửi email lỗi,
 *   voice chưa cấu hình) là lỗi nghiệp vụ, không tính.
 * - Lỗi mạng (fetch reject) liên tiếp khi trình duyệt vẫn online (mất mạng thật là việc của SW / offline.html).
 */
const NETWORK_FAILS_TO_TRIP = 3;

let down = false;
let networkFails = 0;
const listeners = new Set<() => void>();
const set = (v: boolean) => {
  if (down === v) return;
  down = v;
  listeners.forEach((l) => l());
};

/** Phản hồi là trang lỗi của proxy (API đang tắt / khởi động lại), không phải lỗi API tự trả. */
export const isGatewayDown = (res: Response) =>
  (res.status === 502 || res.status === 503 || res.status === 504) && !(res.headers.get('content-type') ?? '').includes('json');

export const maintenance = {
  gatewayDown: () => set(true),
  networkError: () => {
    if (navigator.onLine && ++networkFails >= NETWORK_FAILS_TO_TRIP) set(true);
  },
  /** API vừa trả lời (bất kỳ mã nào khác) → đang chạy. */
  ok: () => {
    networkFails = 0;
    set(false);
  },
};

/** Gọi `/health` (liveness, không cần đăng nhập): true = API đã chạy lại. */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch('/health', { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export const useApiDown = () =>
  useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => down);
