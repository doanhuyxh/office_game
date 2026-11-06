import { http } from '@/services/api-client';
import type { ISystemInfo } from '../types/system.types';

export const systemKeys = { info: ['system', 'info'] as const };

export const systemApi = {
  /** Chỉ admin (back-end kiểm tra). Có kiểm tra Postgres / S3 / SMTP nên có thể mất vài giây. */
  info: () => http<ISystemInfo>('/api/system/info'),
};
