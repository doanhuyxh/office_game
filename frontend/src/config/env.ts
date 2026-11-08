/** Biến môi trường FE (VITE_*). Không chứa bí mật — mọi giá trị đều lộ ra trình duyệt. */
export const ENV = {
  isDev: import.meta.env.DEV,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? '',
} as const;

/** Cấu hình Firebase (push FCM) — không phải bí mật, an toàn để vào bundle công khai. Trống → tắt push ở FE. */
export const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
} as const;

/** Public key (Web Push certificate) — Firebase Console → Cloud Messaging → Web configuration. */
export const FIREBASE_VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '';

/** Endpoint realtime (SignalR). Traefik / Vite proxy /rt sang OfficeHub.Realtime. */
export const REALTIME = {
  officeHub: '/rt/hub/office',
  chatHub: '/rt/hub/chat',
  voiceToken: '/rt/voice/token',
} as const;

/** Key localStorage (chỉ cho tiện ích phía client, không lưu dữ liệu quan trọng). */
export const STORAGE_KEY = {
  theme: 'officehub:theme',
} as const;
