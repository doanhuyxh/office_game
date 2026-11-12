import { http, httpPost } from '@/services/api-client';
import type { IOpsReport, ISaveSettingsRequest, ISettingsGroup, ISettingsTestResult, IStorageReport, ISystemInfo, SettingsGroupKey } from '../types/system.types';

export const systemKeys = { info: ['system', 'info'] as const, storage: ['system', 'storage'] as const, ops: ['system', 'ops'] as const, settings: ['system', 'settings'] as const };

export const systemApi = {
  /** Chỉ admin (back-end kiểm tra). Có kiểm tra Postgres / S3 / SMTP nên có thể mất vài giây. */
  info: () => http<ISystemInfo>('/api/system/info'),
  /** Quét object S3 (server giữ kết quả 10 phút; refresh = quét lại ngay). */
  storage: (refresh = false) => http<IStorageReport>(`/api/system/storage${refresh ? '?refresh=true' : ''}`),
  /** Vận hành: phiên bản, sao lưu S3, hàng đợi email, job nền. */
  ops: () => http<IOpsReport>('/api/system/ops'),
  /** Đưa email đã bỏ cuộc (30 ngày) vào hàng đợi lại. */
  retryEmails: () => httpPost<{ count: number }>('/api/system/ops/email/retry'),
  /** Cấu hình S3 / SMTP / FCM / IP văn phòng (DB, chưa lưu thì .env). Không bao giờ có giá trị bí mật. */
  settings: () => http<ISettingsGroup[]>('/api/system/settings'),
  saveSettings: (group: SettingsGroupKey, body: ISaveSettingsRequest) =>
    http<ISettingsGroup>(`/api/system/settings/${group}`, { method: 'PUT', body: JSON.stringify(body) }),
  /** Xoá cấu hình trong DB → quay về .env. */
  resetSettings: (group: SettingsGroupKey) => http<ISettingsGroup>(`/api/system/settings/${group}`, { method: 'DELETE' }),
  /** Thử cấu hình đang có hiệu lực (S3 ghi + xoá file, SMTP gửi thư cho bạn, FCM dry run, IP so với IP của bạn). */
  testSettings: (group: SettingsGroupKey) => httpPost<ISettingsTestResult>(`/api/system/settings/${group}/test`),
};
