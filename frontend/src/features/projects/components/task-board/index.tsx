import { useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, GripVertical, Plus, Settings2, ShieldCheck } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { promptDialog } from '@/components/common/confirm-dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate } from '@/features/finance';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTasks } from '../../hooks/useProjects';
import type { IProjectDetail, ITask, ITaskColumn } from '../../types/project.types';
import { createColumns, needsMoveNote } from '../../utils/labels';
import { ColumnDialog } from '../column-dialog';
import { TaskDialog } from '../task-dialog';

/** Khoảng trống dưới bảng: padding dưới của <main> (py-6) + lề SidebarInset. */
const BOTTOM_GAP = 32;

/**
 * Chiều cao để bảng kéo tới đáy màn hình (tính từ vị trí của bảng trong trang, không phụ thuộc trang đang cuộn).
 * Đo lại khi đổi cỡ cửa sổ; tối thiểu 360px để màn thấp vẫn dùng được.
 */
function useFillHeight(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(360, window.innerHeight - top - BOTTOM_GAP));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [ready]); // bảng chỉ có trong DOM sau khi tải xong
  return { ref, height };
}

/** Kiểu dữ liệu kéo thả: thẻ việc / tiêu đề cột. */
const TASK = 'text/task';
const COLUMN = 'text/column';

/** Đưa cột `id` tới vị trí của cột `target` (kéo thả tiêu đề cột). */
function reorder(ids: string[], id: string, target: string) {
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (ids.indexOf(id) < ids.indexOf(target) ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Kanban theo cột trạng thái tự do của dự án (cao hết màn hình, cuộn ngang khi nhiều cột, mỗi cột tự cuộn bên trong).
 * Thành viên kéo thẻ sang cột khác; bấm thẻ để sửa / bình luận; lọc "việc của tôi".
 * Chức vụ có quyền "Quản lý trạng thái công việc": kéo tiêu đề cột để sắp xếp, ⚙ để sửa tên / màu / cờ / xoá, "+ Thêm trạng thái" ở cuối.
 * Back-end kiểm quy trình (đi lần lượt, cột cần người duyệt) → toast lỗi; kéo lùi khi đi lần lượt → hỏi lý do trước.
 */
export function TaskBoard({ d, myEmployeeId }: { d: IProjectDetail; myEmployeeId: string | null }) {
  const p = d.project;
  const { data = [], isLoading } = useTasks(p.id);
  const [edit, setEdit] = useState<{ task: ITask | null; columnId?: string } | null>(null);
  const [colEdit, setColEdit] = useState<ITaskColumn | null | undefined>(undefined);
  const [mine, setMine] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const board = useFillHeight(!isLoading);
  const move = useProjectMutation((a: { id: string; columnId: string; note?: string }) => projectApi.moveTask(a.id, a.columnId, a.note));
  const reorderCols = useProjectMutation((ids: string[]) => projectApi.reorderColumns(p.id, ids));
  if (isLoading) return <Spinner />;
  const manage = p.canManageColumns && p.status === 'Active';
  const byId = new Map(d.columns.map((c) => [c.id, c]));
  const columns = pendingOrder ? pendingOrder.map((id) => byId.get(id)).filter((c): c is ITaskColumn => !!c) : d.columns;
  const creatable = new Set(createColumns(columns, p.sequential, p.canManage).map((c) => c.id));
  const shown = mine ? data.filter((t) => t.assigneeEmployeeId === myEmployeeId) : data;
  const dropTask = async (columnId: string, id: string) => {
    const t = data.find((x) => x.id === id);
    if (!t || t.columnId === columnId || !p.canWork) return;
    let note: string | undefined;
    if (needsMoveNote(columns, t.columnId, columnId, p.sequential)) {
      const r = await promptDialog({ title: `Trả ${t.code} về "${byId.get(columnId)?.name}"?`, label: 'Lý do (thành bình luận của việc)',
        multiline: true, required: true, confirmText: 'Chuyển' });
      if (r === null) return;
      note = r;
    }
    move.mutate({ id, columnId, note }, { onError: (err) => toast.error(errorMessage(err)) });
  };
  const dropColumn = (target: string) => {
    const id = dragCol;
    setDragCol(null);
    if (!id || id === target) return;
    const ids = reorder(columns.map((c) => c.id), id, target);
    setPendingOrder(ids);
    reorderCols.mutate(ids, { onError: (err) => toast.error(errorMessage(err)), onSettled: () => setPendingOrder(null) });
  };
  const onDragOver = (e: DragEvent, columnId: string) => {
    const isCol = e.dataTransfer.types.includes(COLUMN);
    if (isCol ? !manage : !p.canWork) return;
    e.preventDefault();
    setOver(columnId);
  };
  const onDrop = (e: DragEvent, columnId: string) => {
    setOver(null);
    if (e.dataTransfer.types.includes(COLUMN)) dropColumn(columnId);
    else void dropTask(columnId, e.dataTransfer.getData(TASK));
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Chỉ việc của tôi</label>
        {!p.canWork && <span className="text-xs text-muted-foreground">{p.status === 'Closed' ? 'Dự án đã đóng — chỉ xem.' : 'Bạn chỉ xem (không phải thành viên).'}</span>}
        {(p.sequential || columns.some((c) => c.approverOnly)) && <span className="text-xs text-muted-foreground" data-testid="review-hint">
          Quy trình:{p.sequential && ' đi lần lượt từng cột · chuyển lùi phải ghi lý do'}
          {columns.some((c) => c.approverOnly) && `${p.sequential ? ' ·' : ''} chỉ quản lý dự án chuyển sang ${columns.filter((c) => c.approverOnly).map((c) => `"${c.name}"`).join(', ')}`}.
        </span>}
        {manage && <span className="text-xs text-muted-foreground">Kéo tiêu đề cột để đổi thứ tự.</span>}
        {manage && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setColEdit(null)}><Plus /> Thêm trạng thái</Button>}
      </div>
      <div ref={board.ref} style={board.height ? { '--board-h': `${board.height}px` } as CSSProperties : undefined}
        className="flex gap-3 overflow-x-auto pb-2 xl:h-(--board-h)">
        {columns.map((c) => {
          const col = shown.filter((t) => t.columnId === c.id);
          return (
            <div key={c.id} data-testid={`col-${c.name}`} onDragOver={(e) => onDragOver(e, c.id)} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, c.id)}
              style={{ borderTopColor: c.color }}
              className={cn('flex max-h-[70dvh] min-h-48 w-72 shrink-0 flex-col gap-2 rounded-xl border border-t-4 p-2 xl:max-h-none xl:min-h-0',
                over === c.id ? 'border-x-primary border-b-primary bg-primary/5' : 'bg-muted/30', dragCol === c.id && 'opacity-50')}>
              <div className="flex items-center gap-1 px-1 text-sm" draggable={manage} data-testid="column-header"
                onDragStart={(e) => { e.dataTransfer.setData(COLUMN, c.id); e.dataTransfer.effectAllowed = 'move'; setDragCol(c.id); }}
                onDragEnd={() => setDragCol(null)}>
                {manage && <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />}
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="min-w-0 truncate font-medium" title={c.name}>{c.name}</span>
                <span className="text-muted-foreground">({col.length})</span>
                {c.isDone && <span title="Trạng thái hoàn thành"><CheckCircle2 className="size-3.5 shrink-0 text-success" aria-label="Hoàn thành" /></span>}
                {c.approverOnly && <span title="Cần người duyệt (chỉ quản lý dự án)"><ShieldCheck className="size-3.5 shrink-0 text-warning" aria-label="Cần người duyệt" /></span>}
                <span className="ml-auto flex shrink-0 items-center">
                  {manage && <Button size="icon" variant="ghost" className="size-7" aria-label={`Sửa trạng thái ${c.name}`} onClick={() => setColEdit(c)}><Settings2 /></Button>}
                  {p.canWork && creatable.has(c.id) && <Button size="icon" variant="ghost" className="size-7" aria-label={`Thêm việc vào ${c.name}`}
                    onClick={() => setEdit({ task: null, columnId: c.id })}><Plus /></Button>}
                </span>
              </div>
              <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
              {col.map((t) => (
                <button key={t.id} type="button" draggable={p.canWork} onDragStart={(e) => e.dataTransfer.setData(TASK, t.id)} onClick={() => setEdit({ task: t })}
                  className="grid gap-1 rounded-lg border bg-card p-2 text-left text-sm shadow-xs hover:border-primary/50" data-testid="task-card">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">{t.code}{t.createdByBot && <BotBadge />}</span>
                  <span className={t.done ? 'text-muted-foreground line-through' : 'font-medium'}>{t.title}</span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {t.assigneeName ?? 'Chưa giao'}
                    {t.dueOn && <span className={t.overdue ? 'text-rose-600' : ''}>hạn {fmtDate(t.dueOn)}</span>}
                    {t.estimateDays != null && <span>{t.estimateDays}d</span>}
                    {t.commentCount > 0 && <span>💬 {t.commentCount}</span>}
                    {t.mediaLinks.length > 0 && <span title="Ảnh / video">🖼 {t.mediaLinks.length}</span>}
                  </span>
                </button>
              ))}
              </div>
            </div>
          );
        })}
        {manage && (
          <button type="button" onClick={() => setColEdit(null)} data-testid="add-column"
            className="flex h-12 w-60 shrink-0 items-center justify-center gap-1 rounded-xl border border-dashed text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground">
            <Plus className="size-4" /> Thêm trạng thái
          </button>
        )}
      </div>
      <TaskDialog projectId={p.id} task={edit?.task ?? (edit ? null : undefined)} initialColumnId={edit?.columnId} columns={columns} members={d.members}
        milestones={d.milestones} canWork={p.canWork} canDelete={p.canManage} sequential={p.sequential} onClose={() => setEdit(null)} />
      <ColumnDialog projectId={p.id} column={colEdit} columns={columns} onClose={() => setColEdit(undefined)} />
    </div>
  );
}
