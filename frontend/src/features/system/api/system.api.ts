import { http, httpPost } from '@/services/api-client';
import type { IOpsReport, IStorageReport, ISystemInfo } from '../types/system.types';

export const systemKeys = { info: ['system', 'info'] as const, storage: ['system', 'storage'] as const, ops: ['system', 'ops'] as const };

export const systemApi = {
  /** Chỉ admin (back-end kiểm tra). Có kiểm tra Postgres / S3 / SMTP nên có thể mất vài giây. */
  info: () => http<ISystemInfo>('/api/system/info'),
  /** Quét object S3 (server giữ kết quả 10 phút; refresh = quét lại ngay). */
  storage: (refresh = false) => http<IStorageReport>(`/api/system/storage${refresh ? '?refresh=true' : ''}`),
  /** Vận hành: phiên bản, sao lưu S3, hàng đợi email, job nền. */
  ops: () => http<IOpsReport>('/api/system/ops'),
  /** Đưa email đã bỏ cuộc (30 ngày) vào hàng đợi lại. */
  retryEmails: () => httpPost<{ count: number }>('/api/system/ops/email/retry'),
};
