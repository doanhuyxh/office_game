/** Biến môi trường FE (VITE_*). Không chứa bí mật — mọi giá trị đều lộ ra trình duyệt. */
export const ENV = {
  isDev: import.meta.env.DEV,
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? '',
} as const;

/** Endpoint realtime (SignalR). Traefik / Vite proxy /rt sang OfficeHub.Realtime. */
export const REALTIME = {
  officeHub: '/rt/hub/office',
  voiceToken: '/rt/voice/token',
} as const;

/** Key localStorage (chỉ cho tiện ích phía client, không lưu dữ liệu quan trọng). */
export const STORAGE_KEY = {
  theme: 'officehub:theme',
} as const;
