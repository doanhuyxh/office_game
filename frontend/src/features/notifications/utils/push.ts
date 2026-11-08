/**
 * Cờ "đã bật thông báo đẩy" của người dùng (localStorage) — không phải nguồn sự thật (quyền trình duyệt + token BE mới là thật),
 * chỉ để UI nhớ lựa chọn và tự đăng ký lại token lúc mở app. Mặc định tắt (khác âm thanh — push cần xin quyền trình duyệt).
 */
const KEY = 'officehub.push-enabled';

const subscribers = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const getPushSnapshot = read;

export function setPushEnabledFlag(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* chế độ riêng tư / bị chặn: bỏ qua, chỉ cập nhật trong phiên */
  }
  subscribers.forEach((cb) => cb());
}

export function subscribePush(cb: () => void) {
  subscribers.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    subscribers.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}
