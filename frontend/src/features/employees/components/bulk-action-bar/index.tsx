import { FileSpreadsheet, PencilLine, UserX, X } from 'lucide-react';
import { Button } from '@/components/common/button';

/**
 * Thanh thao tác khi đã tích chọn nhân viên. Đã chọn hết trang mà bộ lọc còn nhiều hơn → gợi ý "Chọn tất cả N nhân viên khớp bộ lọc".
 */
export function BulkActionBar({ count, pageAllSelected, total, allMatching, loadingAll, onSelectAll, onClear, onEdit, onExport, onResign }: {
  count: number;
  /** Mọi dòng trong trang đang xem đều được chọn. */
  pageAllSelected: boolean;
  /** Tổng số người khớp bộ lọc. */
  total: number;
  /** Đang chọn toàn bộ người khớp bộ lọc. */
  allMatching: boolean;
  loadingAll: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onEdit: () => void;
  onExport: () => void;
  onResign: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2 text-sm">
      <span className="font-medium">Đã chọn {count} nhân viên</span>
      {allMatching ? (
        <span className="text-muted-foreground">(toàn bộ khớp bộ lọc)</span>
      ) : pageAllSelected && total > count && (
        <Button variant="link" size="sm" className="h-auto px-0" disabled={loadingAll} onClick={onSelectAll}>
          {loadingAll ? 'Đang tải…' : `Chọn tất cả ${total} nhân viên khớp bộ lọc`}
        </Button>
      )}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}><PencilLine /> Đổi phòng ban / quản lý / chức vụ</Button>
        <Button size="sm" variant="outline" onClick={onExport}><FileSpreadsheet /> Xuất Excel</Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={onResign}><UserX /> Nghỉ việc</Button>
        <Button size="sm" variant="ghost" onClick={onClear} aria-label="Bỏ chọn"><X /> Bỏ chọn</Button>
      </div>
    </div>
  );
}
