import type { FirebaseApp } from 'firebase/app';
import type { Messaging } from 'firebase/messaging';
import { FIREBASE_CONFIG, FIREBASE_VAPID_KEY } from '@/config/env';

/**
 * Lớp mỏng quanh Firebase SDK (push FCM) — không biết gì về nghiệp vụ thông báo.
 * `features/notifications` gọi các hàm ở đây rồi tự đăng ký token với BE.
 * Import `firebase/app` + `firebase/messaging` ĐỘNG (chỉ khi configured() = true) để không tải SDK này cho
 * mọi người dùng — push là tuỳ chọn, phần lớn deploy có thể chưa cấu hình Firebase.
 */
let app: FirebaseApp | null = null;
let messaging: Messaging | null = null;
let ready: Promise<Messaging | null> | null = null;

const configured = () => Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_VAPID_KEY);

async function getMessagingInstance(): Promise<Messaging | null> {
  if (!configured() || !('serviceWorker' in navigator) || !('Notification' in window)) return null;
  ready ??= (async () => {
    const [{ initializeApp }, { getMessaging, isSupported }] = await Promise.all([import('firebase/app'), import('firebase/messaging')]);
    if (!(await isSupported().catch(() => false))) return null;
    app = initializeApp(FIREBASE_CONFIG);
    return (messaging = getMessaging(app));
  })();
  return ready;
}

/** Trình duyệt / cấu hình có hỗ trợ push không (không hỏi quyền, không tải SDK). */
export const pushAvailable = () => configured() && 'serviceWorker' in navigator && 'Notification' in window;

/** Xin quyền (nếu chưa có) rồi lấy token FCM hiện tại. null = không hỗ trợ / bị từ chối / lỗi. */
export async function requestPushToken(): Promise<string | null> {
  const m = await getMessagingInstance();
  if (!m) return null;
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return null;
  try {
    const { getToken } = await import('firebase/messaging');
    const registration = await navigator.serviceWorker.ready;
    return await getToken(m, { vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: registration });
  } catch {
    return null;
  }
}

/** Token hiện tại nếu quyền đã "granted" từ trước — không xin quyền lại, dùng khi mở app. */
export async function currentPushTokenIfGranted(): Promise<string | null> {
  if (!configured() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return null;
  return requestPushToken();
}

export async function clearPushToken(): Promise<void> {
  if (!messaging) return;
  const { deleteToken } = await import('firebase/messaging');
  await deleteToken(messaging).catch(() => {});
}

/** Tin đến khi tab đang mở (không qua Service Worker `push` event). Trả về hàm huỷ lắng nghe. */
export async function onForegroundPush(cb: (title: string, body: string, link?: string) => void): Promise<() => void> {
  const m = await getMessagingInstance();
  if (!m) return () => {};
  const { onMessage } = await import('firebase/messaging');
  return onMessage(m, (payload) => cb(payload.notification?.title ?? 'OfficeHub', payload.notification?.body ?? '', payload.data?.link));
}
