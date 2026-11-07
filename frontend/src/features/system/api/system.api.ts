import { http } from '@/services/api-client';
import type { IStorageReport, ISystemInfo } from '../types/system.types';

export const systemKeys = { info: ['system', 'info'] as const, storage: ['system', 'storage'] as const };

export const systemApi = {
  /** Chỉ admin (back-end kiểm tra). Có kiểm tra Postgres / S3 / SMTP nên có thể mất vài giây. */
  info: () => http<ISystemInfo>('/api/system/info'),
  /** Quét object S3 (server giữ kết quả 10 phút; refresh = quét lại ngay). */
  storage: (refresh = false) => http<IStorageReport>(`/api/system/storage${refresh ? '?refresh=true' : ''}`),
};
