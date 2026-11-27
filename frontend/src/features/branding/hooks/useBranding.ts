import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { brandingApi, brandingKeys } from '../api/branding.api';
import type { IBranding } from '../types/branding.types';

/** Tên mặc định khi chưa tải xong / API lỗi (như trước khi có cấu hình công ty). */
export const DEFAULT_BRANDING: IBranding = { name: 'OfficeHub', logoUrl: null };

/** Tên + logo công ty (admin đổi ở Hệ thống → Cấu hình → Chung). Luôn trả giá trị (mặc định khi chưa có dữ liệu). */
export function useBranding(): IBranding {
  const { data } = useQuery({ queryKey: brandingKeys.info, queryFn: brandingApi.get, staleTime: 10 * 60_000, retry: 1 });
  return data ?? DEFAULT_BRANDING;
}

/** Tiêu đề tab trình duyệt = tên công ty (gắn một lần ở gốc ứng dụng). */
export function useBrandingTitle() {
  const { name } = useBranding();
  useEffect(() => { document.title = name; }, [name]);
}
