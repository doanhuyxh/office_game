import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

/**
 * Tab đang chọn của trang lưu trên URL (`?tab=departments`) → reload / quay lại / gửi link vẫn đúng tab.
 * Tab mặc định không ghi lên URL. `allowed` (tab người xem được thấy theo vai trò…): tab trên URL không nằm trong đó → dùng mặc định.
 * Đổi tab = thay URL (replace, không thêm lịch sử), giữ nguyên các tham số khác (?asset=…).
 * `opts.param`: tên tham số khác `tab` (sub-tab, vd `?tab=social&platform=facebook`); `opts.reset`: tham số xoá khi đổi tab (sub-tab của tab cũ).
 */
export function useTabParam(defaultTab: string, allowed?: readonly string[], opts?: { param?: string; reset?: readonly string[] }) {
  const param = opts?.param ?? 'tab';
  const reset = opts?.reset;
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const raw = typeof search[param] === 'string' ? (search[param] as string) : undefined;
  const tab = raw && (!allowed || allowed.includes(raw)) ? raw : defaultTab;
  const setTab = useCallback((t: string) => {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => {
        const next: Record<string, unknown> = { ...prev, [param]: t === defaultTab ? undefined : t };
        for (const k of reset ?? []) next[k] = undefined;
        return next;
      }) as never,
      replace: true,
    });
  }, [navigate, defaultTab, param, reset]);
  return [tab, setTab] as const;
}
