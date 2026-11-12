export interface ISystemLink {
  key: 'docs' | 'logs' | 'mail' | string; name: string; url: string | null; note: string;
  /** Nhúng được vào trang (iframe): true / false / null = chưa kiểm tra được. */
  embeddable: boolean | null;
  embedNote: string | null;
}
export interface IHealthItem { name: string; status: 'Healthy' | 'Degraded' | 'Unhealthy' | string; detail: string | null; durationMs: number }
export interface ISmtpInfo { host: string; port: number; useSsl: boolean; username: string | null; fromEmail: string; fromName: string }
export interface ISystemInfo {
  environment: string; version: string; serverTime: string; timeZone: string; startedAt: string;
  seqEnabled: boolean; sentryEnabled: boolean; links: ISystemLink[]; smtp: ISmtpInfo; health: IHealthItem[];
}

/** Báo cáo dung lượng S3 (GET /api/system/storage). Bytes = byte; prefix nhóm tính sau KeyPrefix. */
export interface IStorageGroup { bucket: string; prefix: string; label: string; objects: number; bytes: number; lastModified: string | null }
export interface IStorageObject { bucket: string; key: string; bytes: number; lastModified: string | null; storageClass: string }
export interface IStorageCount { key: string; label: string; objects: number; bytes: number }
export interface IStorageReport {
  generatedAt: string; keyPrefix: string; buckets: string[]; totalObjects: number; totalBytes: number; truncated: boolean;
  estimatedUsdPerMonth: number; groups: IStorageGroup[]; byClass: IStorageCount[]; monthly: IStorageCount[]; largest: IStorageObject[];
}

/** Tab Vận hành (GET /api/system/ops). */
/** timeZone = múi giờ nghiệp vụ của server (Office__TimeZone); utcOffset vd "+07:00". */
export interface IBuildInfo {
  commit: string | null; builtAt: string | null; assemblyVersion: string; startedAt: string; environment: string; timeZone?: string; utcOffset?: string;
}
export interface IBackupItem { kind: 'db' | 'keys' | string; latestKey: string | null; latestAt: string | null; latestBytes: number | null; count: number; totalBytes: number }
export interface IBackupStatus {
  status: 'ok' | 'stale' | 'missing' | 'unconfigured' | 'error' | string; bucket: string | null; prefix: string | null; message: string | null; items: IBackupItem[];
}
export interface IEmailFailure { id: string; to: string | null; title: string; category: string; attempts: number; error: string | null; createdAt: string; gaveUp: boolean }
export interface IEmailQueue {
  pending: number; oldestPendingAt: string | null; retrying: number; sent24h: number; failed: number; skipped30d: number; lastSentAt: string | null;
  recentFailures: IEmailFailure[];
}
export interface IJobStatus {
  key: string; name: string; intervalMinutes: number; lastStartedAt: string | null; lastFinishedAt: string | null; lastDurationMs: number | null;
  lastSucceeded: boolean | null; lastError: string | null; lastErrorAt: string | null; runs: number; failures: number; running: boolean;
  status: 'ok' | 'late' | 'failing' | 'waiting' | string;
}
export interface IOpsReport { generatedAt: string; build: IBuildInfo; backup: IBackupStatus; email: IEmailQueue; jobs: IJobStatus[] }

/** Nhóm cấu hình hệ thống (GET /api/system/settings, TEST-41). source = 'db' (lưu trên trang) | 'env' (chưa lưu, đọc .env). secrets: chỉ cho biết đã đặt chưa. */
export type SettingsGroupKey = 's3' | 'smtp' | 'fcm' | 'office_ips';
export type SettingsValue = string | number | boolean | null | ISettingsIpRange[];
export interface ISettingsIpRange { cidr: string; note: string | null }
export interface ISettingsGroup {
  group: SettingsGroupKey; name: string; source: 'db' | 'env'; updatedAt: string | null; updatedBy: string | null;
  values: Record<string, SettingsValue>; secrets: Record<string, boolean>;
}
/** secrets: để trống / bỏ qua = giữ giá trị cũ; clearSecrets: xoá hẳn. */
export interface ISaveSettingsRequest { values: Record<string, SettingsValue>; secrets?: Record<string, string>; clearSecrets?: string[] }
export interface ISettingsTestResult { ok: boolean; message: string }
