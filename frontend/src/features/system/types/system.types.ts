export interface ISystemLink { key: 'docs' | 'logs' | 'mail' | string; name: string; url: string | null; note: string }
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
