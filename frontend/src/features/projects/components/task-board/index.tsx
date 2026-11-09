import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate } from '@/features/finance';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTasks } from '../../hooks/useProjects';
import type { IProjectDetail, ITask, TaskState } from '../../types/project.types';
import { TASK_STATE, TASK_STATES } from '../../utils/labels';
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

/** Kanban 4 cột (màn rộng: cao hết màn hình, mỗi cột tự cuộn bên trong). Kéo thả thẻ sang cột khác (thành viên); bấm thẻ để sửa / bình luận. Lọc "việc của tôi". */
export function TaskBoard({ d, myEmployeeId }: { d: IProjectDetail; myEmployeeId: string | null }) {
  const p = d.project;
  const { data = [], isLoading } = useTasks(p.id);
  const [edit, setEdit] = useState<{ task: ITask | null; state: TaskState } | null>(null);
  const [mine, setMine] = useState(false);
  const [over, setOver] = useState<TaskState | null>(null);
  const board = useFillHeight(!isLoading);
  const move = useProjectMutation((a: { id: string; state: TaskState }) => projectApi.moveTask(a.id, a.state));
  if (isLoading) return <Spinner />;
  const shown = mine ? data.filter((t) => t.assigneeEmployeeId === myEmployeeId) : data;
  const drop = (state: TaskState, id: string) => {
    setOver(null);
    const t = data.find((x) => x.id === id);
    if (!t || t.state === state || !p.canWork) return;
    move.mutate({ id, state }, { onError: (err) => toast.error(errorMessage(err)) });
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Chỉ việc của tôi</label>
        {!p.canWork && <span className="text-xs text-muted-foreground">{p.status === 'Closed' ? 'Dự án đã đóng — chỉ xem.' : 'Bạn chỉ xem (không phải thành viên).'}</span>}
      </div>
      <div ref={board.ref} style={board.height ? { '--board-h': `${board.height}px` } as CSSProperties : undefined}
        className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:h-(--board-h) xl:grid-cols-4">
        {TASK_STATES.map((s) => {
          const col = shown.filter((t) => t.state === s);
          return (
            <div key={s} data-testid={`col-${s}`} onDragOver={(e) => { if (p.canWork) { e.preventDefault(); setOver(s); } }} onDragLeave={() => setOver(null)}
              onDrop={(e) => drop(s, e.dataTransfer.getData('text/task'))}
              className={`flex max-h-[70dvh] min-h-48 flex-col gap-2 rounded-xl border p-2 xl:max-h-none xl:min-h-0 ${over === s ? 'border-primary bg-primary/5' : 'bg-muted/30'}`}>
              <div className="flex items-center justify-between px-1 text-sm">
                <span className="font-medium">{TASK_STATE[s].label} <span className="text-muted-foreground">({col.length})</span></span>
                {p.canWork && <Button size="icon" variant="ghost" className="size-7" aria-label={`Thêm việc vào ${TASK_STATE[s].label}`} onClick={() => setEdit({ task: null, state: s })}><Plus /></Button>}
              </div>
              <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
              {col.map((t) => (
                <button key={t.id} type="button" draggable={p.canWork} onDragStart={(e) => e.dataTransfer.setData('text/task', t.id)} onClick={() => setEdit({ task: t, state: t.state })}
                  className="grid gap-1 rounded-lg border bg-card p-2 text-left text-sm shadow-xs hover:border-primary/50" data-testid="task-card">
                  <span className="text-xs text-muted-foreground">{t.code}</span>
                  <span className={t.state === 'Done' ? 'text-muted-foreground line-through' : 'font-medium'}>{t.title}</span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {t.assigneeName ?? 'Chưa giao'}
                    {t.dueOn && <span className={t.overdue ? 'text-rose-600' : ''}>hạn {fmtDate(t.dueOn)}</span>}
                    {t.estimateDays != null && <span>{t.estimateDays}d</span>}
                    {t.commentCount > 0 && <span>💬 {t.commentCount}</span>}
                  </span>
                </button>
              ))}
              </div>
            </div>
          );
        })}
      </div>
      <TaskDialog projectId={p.id} task={edit?.task ?? (edit ? null : undefined)} initialState={edit?.state} members={d.members} milestones={d.milestones}
        canWork={p.canWork} canDelete={p.canManage} onClose={() => setEdit(null)} />
    </div>
  );
}
