import { http } from '@/services/api-client';
import type { IBranding } from '../types/branding.types';

export const brandingKeys = { info: ['branding'] as const };

export const brandingApi = {
  /** Không cần đăng nhập (trang đăng nhập, trang chia sẻ công khai dùng chung). */
  get: () => http<IBranding>('/api/branding'),
};
