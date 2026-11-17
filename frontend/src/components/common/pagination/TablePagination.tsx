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
 *
 * `variant="compact"` (bảng trong cột / sheet / hộp thoại hẹp, TEST-133): luôn MỘT dòng — trái "21–40 / 129", phải `‹ 2 / 7 ›`;
 * không có ô "Mỗi trang" và nút đầu / cuối. Bản đầy đủ (mặc định) cũng tự gọn như vậy khi khung chứa < 420 px (container query
 * `@container` trên chính thanh), nên bảng nào lỡ đặt trong khung hẹp vẫn không xuống hàng.
 */
export function TablePagination({ state, total, unit = 'dòng', className, variant = 'full' }: {
  state: PageState; total: number | undefined; unit?: string; className?: string; variant?: 'full' | 'compact';
}) {
  const { page, pageSize, setPage, setPageSize } = state;
  const pageCount = Math.max(1, Math.ceil((total ?? 0) / pageSize));
  useEffect(() => { if (total !== undefined && page > pageCount) setPage(pageCount); }, [total, page, pageCount, setPage]);
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const nav = total > PAGE_SIZES[0];
  const compact = variant === 'compact';
  // Phần chỉ có ở bản đầy đủ khi khung đủ rộng; bản gọn ẩn hẳn.
  const wide = compact ? 'hidden' : 'hidden @min-[420px]:flex';
  const narrow = compact ? '' : '@min-[420px]:hidden';
  return (
    <div className={cn('@container border-t px-3 py-2 text-sm text-muted-foreground', className)} data-testid="pagination" data-variant={variant}>
      <div className={cn('flex items-center justify-between gap-2', compact ? 'flex-nowrap' : 'flex-nowrap @min-[420px]:flex-wrap')}>
        <span className="min-w-0 truncate tabular-nums">
          {nav ? `${from}–${to} / ` : ''}{total}<span className={cn(compact && 'hidden', narrow && 'hidden @min-[420px]:inline')}> {unit}</span>
        </span>
        {nav && (
          <div className="flex shrink-0 items-center gap-2">
            <div className={cn('items-center gap-2', wide)}>
              <span className="hidden sm:inline">Mỗi trang</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger size="sm" className="w-18" aria-label="Số dòng mỗi trang"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon-sm" className={wide} aria-label="Trang đầu" disabled={page <= 1} onClick={() => setPage(1)}><ChevronsLeft /></Button>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
              <span className="min-w-12 text-center whitespace-nowrap tabular-nums" aria-live="polite">
                <span className={cn(compact && 'hidden', narrow && 'hidden @min-[420px]:inline')}>Trang {page}/{pageCount}</span>
                <span className={cn(narrow)} aria-label={`Trang ${page} trên ${pageCount}`}>{page} / {pageCount}</span>
              </span>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Trang sau" disabled={page >= pageCount} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
              <Button type="button" variant="outline" size="icon-sm" className={wide} aria-label="Trang cuối" disabled={page >= pageCount} onClick={() => setPage(pageCount)}><ChevronsRight /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
