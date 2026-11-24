import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, ChevronDown, Eye, EyeOff, MoreHorizontal, MoveRight, Trash2, UserRoundCog, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import type { IBulkTasksResult, IProjectDetail, ITask } from '../../types/project.types';
import { TaskBulkDeleteDialog } from '../task-bulk-delete-dialog';
import { TaskBulkDialog, type BulkEditKind } from '../task-bulk-dialog';
import { TaskBulkResultDialog } from '../task-bulk-result-dialog';

const DONE: Record<BulkEditKind | 'delete', string> = {
  move: 'Chuyển trạng thái', assign: 'Giao việc', due: 'Đổi hạn', follow: 'Thêm người theo dõi', unfollow: 'Bỏ người theo dõi', delete: 'Xoá việc',
};

/**
 * Thanh thao tác hàng loạt (danh sách + kanban) dính đáy khung tab Công việc khi đã tích chọn việc: chuyển trạng thái, giao người, đổi hạn,
 * thêm / bỏ người theo dõi, xoá (gõ "delete" xác nhận). Thành công từng phần: việc đã làm được bỏ chọn, việc bị bỏ qua vẫn chọn + hiện lý do.
 * Chỉ web (back-end chặn token AI). Thông báo / lịch sử / đánh thức bot do từng việc tự xử lý như thao tác tay.
 */
export function TaskBulkBar({ d, selected, onRemove, onClear }: {
  d: IProjectDetail; selected: ITask[]; onRemove: (ids: string[]) => void; onClear: () => void;
}) {
  const p = d.project;
  const [kind, setKind] = useState<BulkEditKind | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<{ r: IBulkTasksResult; label: string } | null>(null);
  if (selected.length === 0 && !kind && !deleting && !result) return null;

  const done = (r: IBulkTasksResult, label: string) => {
    onRemove(r.applied);
    if (r.skipped.length > 0) setResult({ r, label });
    else toast.success(`${label}: đã áp dụng cho ${r.applied.length} việc`);
  };
  return (
    <>
      {selected.length > 0 && (
        <div className="sticky bottom-3 z-10 mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-lg" data-testid="bulk-bar" role="toolbar" aria-label="Thao tác hàng loạt">
          <span className="font-medium" data-testid="bulk-count">Đã chọn {selected.length} việc</span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onClear} data-testid="bulk-clear"><X /> Bỏ chọn</Button>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setKind('move')} data-testid="bulk-move"><MoveRight /> Chuyển trạng thái</Button>
            <Button size="sm" variant="outline" onClick={() => setKind('assign')} data-testid="bulk-assign"><UserRoundCog /> Giao cho</Button>
            <Button size="sm" variant="outline" onClick={() => setKind('due')} data-testid="bulk-due-btn"><CalendarClock /> Đổi hạn</Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="bulk-follow-menu"><Eye /> Theo dõi <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setKind('follow')} data-testid="bulk-follow"><Eye /> Thêm người theo dõi</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setKind('unfollow')} data-testid="bulk-unfollow"><EyeOff /> Bỏ người theo dõi</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="Thao tác khác" data-testid="bulk-more"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)} data-testid="bulk-delete"><Trash2 /> Xoá {selected.length} việc…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      <TaskBulkDialog projectId={p.id} kind={kind} tasks={selected} columns={d.columns} members={d.members} sequential={p.sequential} canApprove={p.canManage}
        onClose={() => setKind(null)} onResult={(r, k) => done(r, DONE[k])} />
      <TaskBulkDeleteDialog projectId={p.id} tasks={selected} open={deleting} onClose={() => setDeleting(false)} onResult={(r) => done(r, DONE.delete)} />
      <TaskBulkResultDialog result={result?.r ?? null} label={result?.label ?? ''} onClose={() => setResult(null)} />
    </>
  );
}
