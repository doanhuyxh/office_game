import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { clearPushToken, currentPushTokenIfGranted, onForegroundPush, pushAvailable, requestPushToken } from '@/services/firebase';
import { notificationApi } from '../api/notification.api';
import { linkTarget } from '../utils/labels';
import { playNotificationSound } from '../utils/sound';
import { getPushSnapshot, setPushEnabledFlag, subscribePush } from '../utils/push';

/** Bật/tắt thông báo đẩy (FCM): [đã bật theo lựa chọn người dùng, trình duyệt có hỗ trợ không, hàm bật, hàm tắt]. */
export function usePush() {
  const enabled = useSyncExternalStore(subscribePush, getPushSnapshot, getPushSnapshot);

  const enable = useCallback(async () => {
    const token = await requestPushToken();
    if (!token) return false;
    await notificationApi.registerPushToken(token);
    setPushEnabledFlag(true);
    return true;
  }, []);

  const disable = useCallback(async () => {
    const token = await requestPushToken().catch(() => null); // token hiện tại để huỷ đúng dòng ở BE
    setPushEnabledFlag(false);
    await clearPushToken();
    if (token) await notificationApi.unregisterPushToken(token).catch(() => {});
  }, []);

  return { enabled, supported: pushAvailable(), enable, disable } as const;
}

/**
 * Gọi một lần khi mở app: nếu người dùng đã bật trước đó và quyền trình duyệt vẫn "granted" → đăng ký lại token
 * (có thể đã đổi). Im lặng, không xin quyền lại, không báo lỗi lên UI.
 */
export async function syncPushTokenIfEnabled() {
  if (!getPushSnapshot()) return;
  const token = await currentPushTokenIfGranted();
  if (token) await notificationApi.registerPushToken(token).catch(() => {});
}

/**
 * Mount một lần (MainLayout): đồng bộ token lúc mở app (nếu đã bật trước) + lắng nghe push khi tab đang mở
 * (không qua Service Worker) → phát âm chuông + toast, bấm vào thì điều hướng như chuông thường.
 */
export function usePushForeground() {
  const navigate = useNavigate();
  useEffect(() => {
    void syncPushTokenIfEnabled();
    let unsub: (() => void) | undefined;
    void onForegroundPush((title, body, link) => {
      playNotificationSound();
      toast.info(title, { description: body, action: link ? { label: 'Xem', onClick: () => void navigate(linkTarget(link)) } : undefined });
    }).then((u) => (unsub = u));
    return () => unsub?.();
  }, [navigate]);
}
