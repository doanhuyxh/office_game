import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

/**
 * Tab đang chọn của trang lưu trên URL (`?tab=departments`) → reload / quay lại / gửi link vẫn đúng tab.
 * Tab mặc định không ghi lên URL. `allowed` (tab người xem được thấy theo vai trò…): tab trên URL không nằm trong đó → dùng mặc định.
 * Đổi tab = thay URL (replace, không thêm lịch sử), giữ nguyên các tham số khác (?asset=…).
 */
export function useTabParam(defaultTab: string, allowed?: readonly string[]) {
  const search = useSearch({ strict: false }) as { tab?: unknown };
  const navigate = useNavigate();
  const raw = typeof search.tab === 'string' ? search.tab : undefined;
  const tab = raw && (!allowed || allowed.includes(raw)) ? raw : defaultTab;
  const setTab = useCallback((t: string) => {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => ({ ...prev, tab: t === defaultTab ? undefined : t })) as never,
      replace: true,
    });
  }, [navigate, defaultTab]);
  return [tab, setTab] as const;
}
