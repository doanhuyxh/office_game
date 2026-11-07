/**
 * Âm thanh chuông thông báo (chỉ phía trình duyệt).
 * Bật/tắt lưu ở localStorage, mặc định bật. Dùng useSyncExternalStore để chuông và
 * trang hồ sơ cùng phản ứng khi đổi. File âm: public/sounds/notification.mp3.
 */
const KEY = 'officehub.notification-sound';
const SRC = '/sounds/notification.mp3';

const subscribers = new Set<() => void>();
let audio: HTMLAudioElement | null = null;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'; // mặc định bật khi chưa có giá trị
  } catch {
    return true;
  }
}

/** Snapshot cho useSyncExternalStore (primitive → so sánh bằng Object.is). */
export const getSoundSnapshot = read;

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* chế độ riêng tư / bị chặn: bỏ qua, chỉ cập nhật trong phiên */
  }
  subscribers.forEach((cb) => cb());
}

export function subscribeSound(cb: () => void) {
  subscribers.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener('storage', onStorage); // đồng bộ giữa các tab
  return () => {
    subscribers.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

/** Phát tiếng chuông nếu đang bật. Trình duyệt chặn phát khi chưa có tương tác → nuốt lỗi. */
export function playNotificationSound() {
  if (!read()) return;
  try {
    if (!audio) {
      audio = new Audio(SRC);
      audio.preload = 'auto';
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    /* không hỗ trợ Audio: bỏ qua */
  }
}
