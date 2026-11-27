/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  /** Commit Git + giờ build của bản web (frontend/Dockerfile ← scripts/deploy.sh) — trang Hệ thống → Vận hành. */
  readonly VITE_APP_COMMIT?: string;
  readonly VITE_APP_BUILD_TIME?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_VAPID_KEY?: string;
}
