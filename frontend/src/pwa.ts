import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/**
 * PWA: đăng ký service worker (public/sw.js — chỉ bản build production), báo khi có bản mới, và nút "Cài ứng dụng".
 * public/sw.js cũng xử lý push FCM (chuông / Chat / Bảng tin) — xem features/notifications, services/firebase.ts.
 * iOS Safari: push chỉ hoạt động khi đã "Thêm vào màn hình chính" (giới hạn của Apple), không phải trong tab Safari thường.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** iPhone / iPad không có sự kiện cài đặt → hướng dẫn "Thêm vào Màn hình chính" thủ công. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let registration: ServiceWorkerRegistration | null = null;
let updatePrompted = false;

/**
 * Toast "Có phiên bản OfficeHub mới" — dùng chung cho service worker (`updatefound`) và kiểm tra `/version.json`,
 * hiện tối đa MỘT lần mỗi tab (id cố định + cờ). Chỉ nhắc, không tự tải lại (người dùng có thể đang nhập dở).
 * "Tải lại": có SW đang chờ → skip-waiting (controllerchange tự reload); không thì reload thường (trang luôn lấy mạng).
 */
function promptUpdate() {
  if (updatePrompted) return;
  updatePrompted = true;
  toast.info('Có phiên bản OfficeHub mới', {
    id: 'officehub-update',
    duration: Infinity,
    action: {
      label: 'Tải lại',
      onClick: () => {
        const w = registration?.waiting;
        if (w && navigator.serviceWorker.controller) w.postMessage('skip-waiting');
        else location.reload();
      },
    },
  });
}

const VERSION_POLL_MS = 5 * 60 * 1000;
const VERSION_MIN_GAP_MS = 15 * 1000; // focus + visibilitychange bắn liền nhau → một lần hỏi
let lastVersionCheck = 0;

/** Hỏi `/version.json` (fetch thẳng, không qua api-client → lỗi mạng không bật trang bảo trì); mã khác bản đang chạy → nhắc. */
async function checkVersion() {
  if (updatePrompted || Date.now() - lastVersionCheck < VERSION_MIN_GAP_MS) return;
  lastVersionCheck = Date.now();
  try {
    const res = await fetch('/version.json', { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: unknown };
    if (typeof build === 'string' && build && build !== import.meta.env.VITE_APP_BUILD_ID) {
      void registration?.update().catch(() => {}); // để SW mới cài sẵn → "Tải lại" kích hoạt ngay + dọn cache cũ
      promptUpdate();
    }
  } catch { /* mất mạng / đang deploy → bỏ qua, lần sau hỏi lại */ }
}

/** Tab đang mở tự phát hiện bản web mới sau deploy (TEST-227): mỗi 5 phút + khi tab được focus / hiện lại. Chỉ bản build. */
function watchVersion() {
  setInterval(() => { if (document.visibilityState === 'visible') void checkVersion(); }, VERSION_POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkVersion(); });
  addEventListener('focus', () => void checkVersion());
}

export function registerPwa() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; emit(); });
  addEventListener('appinstalled', () => { deferred = null; emit(); toast.success('Đã cài OfficeHub lên thiết bị'); });

  if (!import.meta.env.PROD) return;
  watchVersion();
  if (!('serviceWorker' in navigator)) return;
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
      // Kiểm tra bản mới mỗi giờ (app mở cả ngày trên điện thoại)
      setInterval(() => void reg.update(), 60 * 60 * 1000);
    } catch { /* không có SW vẫn dùng bình thường */ }
  });
}

/** Trạng thái cài đặt: 'prompt' (Chrome / Android / Edge), 'ios' (hướng dẫn tay), 'installed', 'unsupported'. */
export function usePwaInstall() {
  const state = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (isStandalone() ? 'installed' : deferred ? 'prompt' : isIos() ? 'ios' : 'unsupported'),
  );
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    emit();
  };
  return { state, install } as const;
}
