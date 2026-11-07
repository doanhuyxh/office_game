import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/common/select';
import { cn } from '@/utils/cn';
import { PAGE_SIZES, type PageState } from './usePageState';

/**
 * Thanh phân trang đặt ngay dưới `<Table>` (trong cùng khung `rounded-xl border bg-card`): "1–20 / 93 nhân viên", chọn số dòng / trang,
 * nút đầu / trước / sau / cuối. `total` lấy từ trang API trả về (`data?.total`); chưa có dữ liệu hoặc 0 dòng → không hiện;
 * ≤ 10 dòng → chỉ hiện tổng số. Trang hiện tại vượt quá số trang (vd xoá dòng cuối) → tự lùi về trang cuối.
 */
export function TablePagination({ state, total, unit = 'dòng', className }: { state: PageState; total: number | undefined; unit?: string; className?: string }) {
  const { page, pageSize, setPage, setPageSize } = state;
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize));
  useEffect(() => { if (total !== undefined && page > pageCount) setPage(pageCount); }, [total, page, pageCount, setPage]);
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nav = total > PAGE_SIZES[0];
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground', className)} data-testid="pagination">
      <span>{nav ? `${from}–${to} / ` : ''}{total} {unit}</span>
      {nav && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden sm:inline">Mỗi trang</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger size="sm" className="w-18" aria-label="Số dòng mỗi trang"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Trang đầu" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft /></Button>
            <Button variant="outline" size="icon-sm" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
            <span className="min-w-16 text-center tabular-nums">Trang {page}/{pageCount}</span>
            <Button variant="outline" size="icon-sm" aria-label="Trang sau" disabled={page >= pageCount} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
            <Button variant="outline" size="icon-sm" aria-label="Trang cuối" disabled={page >= pageCount} onClick={() => setPage(pageCount)}><ChevronsRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
