import { useCallback, useMemo, useState } from 'react';

export interface ColumnDef {
  /** Khoá ổn định (đổi khoá = mất lựa chọn đã lưu của cột đó). */
  id: string;
  label: string;
  /** Không cho ẩn (vd tên nhân viên). */
  required?: boolean;
  /** Mặc định ẩn (người dùng tự bật). */
  defaultHidden?: boolean;
}

export interface ColumnState {
  columns: ColumnDef[];
  /** Cột có đang hiện không. */
  show: (id: string) => boolean;
  toggle: (id: string, visible: boolean) => void;
  reset: () => void;
  /** Số cột đang hiện (cộng `extra` cột cố định như cột thao tác) — dùng cho colSpan dòng trống. */
  span: (extra?: number) => number;
  hiddenCount: number;
}

const storageKey = (tableId: string) => `officehub.columns.${tableId}`;

function load(tableId: string): Record<string, boolean> | null {
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
  } catch {
    return null; // chế độ riêng tư / bị chặn lưu → dùng mặc định
  }
}

/**
 * Ẩn / hiện cột cho bảng nhiều cột. Lựa chọn lưu theo `tableId` trên trình duyệt (localStorage, mỗi máy một kiểu —
 * chỉ là tuỳ chọn hiển thị). Chỉ lưu các cột người dùng đã bấm; cột mới thêm sau này theo `defaultHidden`.
 */
export function useColumns(tableId: string, columns: ColumnDef[]): ColumnState {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => load(tableId) ?? {});
  const persist = (next: Record<string, boolean>) => {
    setOverrides(next);
    try { localStorage.setItem(storageKey(tableId), JSON.stringify(next)); } catch { /* bỏ qua */ }
  };
  const show = useCallback((id: string) => {
    const c = columns.find((x) => x.id === id);
    if (!c) return true;
    if (c.required) return true;
    return overrides[id] ?? !c.defaultHidden;
  }, [columns, overrides]);
  const visibleCount = useMemo(() => columns.filter((c) => show(c.id)).length, [columns, show]);
  return {
    columns,
    show,
    toggle: (id, visible) => persist({ ...overrides, [id]: visible }),
    reset: () => persist({}),
    span: (extra = 0) => visibleCount + extra,
    hiddenCount: columns.length - visibleCount,
  };
}
