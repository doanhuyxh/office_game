import { useCallback, useMemo, useState } from 'react';
import type { IPageQuery } from '@/types/api';

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

export interface PageState {
  page: number;
  pageSize: number;
  /** Truyền cho hook `use…Page(…, query)` → API nhận `page` / `pageSize` (phân trang ở back-end). */
  query: IPageQuery;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
}

const storageKey = (tableId: string) => `officehub.pageSize.${tableId}`;

function loadSize(tableId: string): number | null {
  try {
    const n = Number(localStorage.getItem(storageKey(tableId)));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : null;
  } catch {
    return null; // chế độ riêng tư / bị chặn lưu → dùng mặc định
  }
}

/**
 * Trạng thái trang của một bảng (dữ liệu do BE cắt trang). Số dòng / trang lưu theo `tableId` trên trình duyệt
 * (localStorage `officehub.pageSize.<tableId>`, giống nút "Cột"). `resetKey` đổi (tìm kiếm, bộ lọc, tháng…) → về trang 1.
 * `defaultSize`: số dòng khi chưa chọn (danh sách trong khung hẹp dùng 10).
 */
export function usePageState(tableId: string, resetKey: string = '', defaultSize: number = DEFAULT_PAGE_SIZE): PageState {
  const [pageSize, setPageSizeState] = useState(() => loadSize(tableId) ?? defaultSize);
  const [page, setPageState] = useState(1);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) { // đổi bộ lọc → về trang 1 ngay trong lần render này (không nháy trang cũ)
    setSeenKey(resetKey);
    setPageState(1);
  }
  const setPage = useCallback((p: number) => setPageState(Math.max(1, p)), []);
  const setPageSize = useCallback((n: number) => {
    setPageSizeState(n);
    setPageState(1);
    try { localStorage.setItem(storageKey(tableId), String(n)); } catch { /* bỏ qua */ }
  }, [tableId]);
  const query = useMemo(() => ({ page, pageSize }), [page, pageSize]);
  return { page, pageSize, query, setPage, setPageSize };
}
