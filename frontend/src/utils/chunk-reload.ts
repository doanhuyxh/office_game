/**
 * Lỗi tải chunk sau deploy (TEST-67): tab đang mở còn giữ bản cũ, chuyển trang thì file JS lazy cũ đã bị xoá.
 * → tự tải lại trang MỘT lần (mốc thời gian trong sessionStorage chống lặp vô hạn); lần sau vẫn lỗi → trang "Hệ thống vừa được cập nhật".
 */
const KEY = 'officehub:chunk-reload';
const WINDOW_MS = 60_000;

const CHUNK_MESSAGES = [
  'Failed to fetch dynamically imported module', // Chrome
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Unable to preload CSS', // vite:preloadError cho file CSS
];

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return CHUNK_MESSAGES.some((m) => msg.includes(m));
}

/** Tải lại trang nếu chưa thử trong 60 giây gần đây. Trả true nếu đang tải lại. */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false; // không có sessionStorage → không tự tải lại (tránh lặp)
  }
  location.reload();
  return true;
}

/** Vite báo lỗi preload chunk / CSS → tải lại một lần thay vì để lỗi rơi vào màn hình. */
export function registerChunkReload() {
  addEventListener('vite:preloadError', (e) => {
    if (reloadOnceForChunkError()) e.preventDefault();
  });
}
