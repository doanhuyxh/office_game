import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/**
 * PWA: đăng ký service worker (public/sw.js — chỉ bản build production), báo khi có bản mới, và nút "Cài ứng dụng".
 * Không có push notification (chủ dự án chốt) — thông báo vẫn qua chuông / email.
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

export function registerPwa() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; emit(); });
  addEventListener('appinstalled', () => { deferred = null; emit(); toast.success('Đã cài OfficeHub lên thiết bị'); });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const prompt = (w: ServiceWorker) => toast.info('Có phiên bản OfficeHub mới', {
        duration: Infinity,
        action: { label: 'Tải lại', onClick: () => w.postMessage('skip-waiting') },
      });
      if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
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
