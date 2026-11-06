export interface ISystemLink { key: 'docs' | 'logs' | 'mail' | string; name: string; url: string | null; note: string }
export interface IHealthItem { name: string; status: 'Healthy' | 'Degraded' | 'Unhealthy' | string; detail: string | null; durationMs: number }
export interface ISmtpInfo { host: string; port: number; useSsl: boolean; username: string | null; fromEmail: string; fromName: string }
export interface ISystemInfo {
  environment: string; version: string; serverTime: string; timeZone: string; startedAt: string;
  seqEnabled: boolean; sentryEnabled: boolean; links: ISystemLink[]; smtp: ISmtpInfo; health: IHealthItem[];
}
