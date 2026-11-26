import { Skeleton } from '@/components/common/skeleton';
import type { ITaskColumn } from '../../types/project.types';

/** Số thẻ giả mỗi cột (lặp theo vị trí cột cho tự nhiên). */
const CARDS = [3, 2, 4, 1, 2, 3];

/**
 * Khung kanban giả khi danh sách việc đang tải lần đầu mà chi tiết dự án (cột trạng thái) đã về (TEST-241) — thay spinner toàn tab:
 * đúng tên / màu / thứ tự cột của dự án, thẻ việc nhấp nháy; cùng kích thước cột với bảng thật nên không nhảy bố cục khi việc về.
 */
export function KanbanSkeleton({ columns }: { columns: ITaskColumn[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto p-3" data-testid="kanban-skeleton" aria-busy="true" aria-label="Đang tải công việc">
      {columns.map((c, i) => (
        <div key={c.id} style={{ borderTopColor: c.color }} className="flex min-h-48 w-72 shrink-0 flex-col gap-2 rounded-xl border border-t-4 bg-muted/30 p-2">
          <div className="flex items-center gap-1 px-1 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
            <span className="min-w-0 truncate font-medium" title={c.name}>{c.name}</span>
          </div>
          {Array.from({ length: CARDS[i % CARDS.length] }, (_, k) => (
            <div key={k} className="grid gap-2 rounded-lg border bg-card p-3">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
