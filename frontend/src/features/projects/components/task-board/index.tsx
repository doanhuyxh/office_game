import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import { useMutationState, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckCircle2, Columns3, GripVertical, List, Loader2, Plus, Settings2, ShieldCheck, Square, SquareCheck, SquareMinus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { promptDialog } from '@/components/common/confirm-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/common/tooltip';
import { STORAGE_KEY } from '@/config/env';
import { ApiError } from '@/services/api-client';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { moveTaskKey, prefetchTask, useMoveTask, useProjectMutation, useTaskDetail, useTasks, type IMoveTaskArgs } from '../../hooks/useProjects';
import type { IProjectDetail, ITask, ITaskColumn } from '../../types/project.types';
import { createColumns, moveBlockReason, needsMoveNote } from '../../utils/labels';
import { checkState, rangeIds, withIds } from '../../utils/task-bulk';
import { readStored, writeStored, type TaskView } from '../../utils/task-list';
import { ColumnDialog } from '../column-dialog';
import { ColumnWakeIcon } from '../column-wake-icon';
import { KanbanSkeleton } from '../kanban-skeleton';
import { KanbanTaskCard } from '../kanban-task-card';
import { TaskBulkBar } from '../task-bulk-bar';
import { TaskDialog } from '../task-dialog';
import { TaskList } from '../task-list';

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
const DESC_KEY = 'projects.taskBoard.descColumns';

/** Id các cột đang xem giảm dần (nhớ theo trình duyệt). */
function readDesc() {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(DESC_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set<string>(); }
}

/** Nút chuyển chế độ xem Cột / Danh sách (TEST-192) — nhớ theo trình duyệt. */
function ViewToggle({ view, onChange }: { view: TaskView; onChange: (v: TaskView) => void }) {
  const item = (v: TaskView, label: string, Icon: typeof List) => (
    <button type="button" aria-pressed={view === v} onClick={() => onChange(v)} data-testid={`view-${v}`}
      className={cn('inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        view === v ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground')}>
      <Icon className="size-4" aria-hidden />{label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-border/70 p-0.5" role="group" aria-label="Chế độ xem công việc">
      {item('board', 'Cột', Columns3)}{item('list', 'Danh sách', List)}
    </div>
  );
}

/** Đưa cột `id` tới vị trí của cột `target` (kéo thả tiêu đề cột). */
/** Nút chọn / bỏ chọn cả cột (thao tác hàng loạt) — cùng kiểu nút biểu tượng với sắp xếp / cài đặt; biểu tượng theo trạng thái: không / một phần / cả cột. */
function ColumnSelectButton({ name, state, onToggle }: { name: string; state: boolean | 'indeterminate'; onToggle: (on: boolean) => void }) {
  const Icon = state === true ? SquareCheck : state === 'indeterminate' ? SquareMinus : Square;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className={cn('size-7', state !== false && 'text-primary')} data-testid="column-check" aria-pressed={state === true ? true : state === 'indeterminate' ? 'mixed' : false}
          aria-label={state === true ? `Bỏ chọn cả cột ${name}` : `Chọn cả cột ${name}`} onClick={() => onToggle(state !== true)}><Icon /></Button>
      </TooltipTrigger>
      <TooltipContent>{state === true ? 'Bỏ chọn tất cả việc trong cột' : 'Chọn tất cả việc trong cột'}</TooltipContent>
    </Tooltip>
  );
}

function reorder(ids: string[], id: string, target: string) {
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (ids.indexOf(id) < ids.indexOf(target) ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Kanban theo cột trạng thái tự do của dự án (cao hết màn hình, cuộn ngang khi nhiều cột, mỗi cột tự cuộn bên trong).
 * Thành viên kéo thẻ sang cột khác; bấm thẻ để sửa / bình luận; lọc "việc của tôi".
 * Chức vụ có quyền "Quản lý trạng thái công việc": kéo tiêu đề cột để sắp xếp, ⚙ để sửa tên / màu / cờ / xoá, nút "Thêm trạng thái" trên thanh công cụ.
 * Back-end kiểm quy trình (đi lần lượt, cột cần người duyệt) → toast lỗi; kéo lùi khi đi lần lượt → hỏi lý do trước.
 * Kéo thẻ (TEST-72): thẻ nguồn mờ, cột không thả được mờ + ghi lý do (quy tắc FE chỉ gợi ý); thả → thẻ sang cột mới ngay (`useMoveTask` optimistic),
 * spinner + khoá thẻ tới khi lưu xong, nháy viền khi xong (primary) / khi lỗi thẻ quay về cột cũ (destructive).
 * Việc đang mở nằm trên URL `?task=<id>` (+ `&comment=<id>` từ chuông bình luận → cuộn tới) để link chuông / copy link mở thẳng hộp thoại (TEST-66);
 * lấy theo id nên mở được cả việc đã xong / đang bị lọc. Đóng hộp thoại → bỏ task / comment khỏi URL (replace).
 * Nút Cột / Danh sách (TEST-192, nhớ theo trình duyệt): Danh sách = `TaskList` trên cùng dữ liệu, dùng chung hộp thoại việc / tạo việc ở đây.
 */
export function TaskBoard({ d, myEmployeeId }: { d: IProjectDetail; myEmployeeId: string | null }) {
  const p = d.project;
  const tasks = useTasks(p.id);
  const { data = [], isLoading } = tasks;
  const [view, setViewState] = useState<TaskView>(() => readStored(STORAGE_KEY.projectTaskView, ['board', 'list'] as const, 'board'));
  const setView = (v: TaskView) => { setViewState(v); writeStored(STORAGE_KEY.projectTaskView, v); };
  const [create, setCreate] = useState<{ columnId: string } | null>(null);
  const search = useSearch({ strict: false }) as { task?: string; comment?: string };
  const navigate = useNavigate();
  const openTask = (task: string | undefined) =>
    void navigate({ to: '.', search: ((prev: Record<string, unknown>) => ({ ...prev, task, comment: undefined })) as never, replace: true });
  const linked = useTaskDetail(search.task ?? null);
  // TEST-242: rê chuột / focus thẻ hoặc dòng ≥ 150 ms → tải trước chi tiết việc (lướt chuột qua bảng không bắn request cho từng thẻ)
  const qc = useQueryClient();
  const hoverTimer = useRef<number | undefined>(undefined);
  const hoverTask = (id: string | null) => {
    window.clearTimeout(hoverTimer.current);
    if (id) hoverTimer.current = window.setTimeout(() => prefetchTask(qc, id), 150);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // TEST-242: chỉ 4xx (không có / không có quyền) hoặc việc không nằm trong danh sách mới đóng hộp thoại; lỗi tạm (500, mạng) với việc đang có trong
  // danh sách → giữ hộp thoại, vùng mô tả hiện "Không tải được chi tiết việc" + Thử lại.
  const notFound = linked.error instanceof ApiError && linked.error.status >= 400 && linked.error.status < 500;
  const missing = !!search.task && ((linked.isError && (notFound || !data.some((t) => t.id === search.task))) || (!!linked.data && linked.data.task.projectId !== p.id));
  useEffect(() => {
    if (!missing) return;
    toast.error(linked.isError && !notFound ? errorMessage(linked.error, 'Không tải được việc') : 'Không tìm thấy việc');
    openTask(undefined);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [missing]);
  const [colEdit, setColEdit] = useState<ITaskColumn | null | undefined>(undefined);
  const [mine, setMine] = useState(false);
  const [desc, setDesc] = useState(readDesc);
  const [over, setOver] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const [savingCol, setSavingCol] = useState<string | null>(null);
  const [dragTask, setDragTask] = useState<ITask | null>(null);
  const [flash, setFlash] = useState<Record<string, 'ok' | 'err'>>({});
  const board = useFillHeight(!isLoading && view === 'board');
  const move = useMoveTask(p.id);
  const moving = new Set(useMutationState({ filters: { mutationKey: moveTaskKey(p.id), status: 'pending' },
    select: (m) => (m.state.variables as IMoveTaskArgs | undefined)?.task.id }));
  const reorderCols = useProjectMutation((ids: string[]) => projectApi.reorderColumns(p.id, ids));
  // Thao tác hàng loạt (danh sách + kanban dùng chung một tập chọn); lựa chọn gắn với việc đang hiện: bộ lọc / "Chỉ việc của tôi" / việc bị xoá → bỏ chọn.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const lastPick = useRef<string | null>(null);
  const keepOnly = useCallback((ids: string[]) => setSelected((prev) => {
    const keep = new Set(ids);
    const next = new Set([...prev].filter((id) => keep.has(id)));
    return next.size === prev.size ? prev : next;
  }), []);
  useEffect(() => {
    if (view === 'board' && !isLoading) keepOnly(data.filter((t) => !mine || t.assigneeEmployeeId === myEmployeeId).map((t) => t.id));
  }, [view, isLoading, data, mine, myEmployeeId, keepOnly]);
  // TEST-241: danh sách việc tải song song với chi tiết dự án — chi tiết về trước thì hiện khung kanban giả theo cột của dự án
  if (isLoading && view === 'board') return <KanbanSkeleton columns={d.columns} />;
  const manage = p.canManageColumns && p.status === 'Active';
  const byId = new Map(d.columns.map((c) => [c.id, c]));
  const columns = pendingOrder ? pendingOrder.map((id) => byId.get(id)).filter((c): c is ITaskColumn => !!c) : d.columns;
  const creatable = new Set(createColumns(columns, p.sequential, p.canManage).map((c) => c.id));
  /** Chỉ xem (TEST-192): không có quyền làm việc. Dự án đã đóng: back-end chỉ cho quản lý dự án / HR canWork (TEST-213). */
  const readOnly = !p.canWork;
  const firstCreatable = columns.find((c) => creatable.has(c.id));
  const opened: ITask | undefined = search.task && !missing ? data.find((t) => t.id === search.task) ?? linked.data?.task : undefined;
  const shown = mine ? data.filter((t) => t.assigneeEmployeeId === myEmployeeId) : data;
  const selectable = p.canWork;
  const setIds = (ids: string[], on: boolean) => setSelected((prev) => withIds(prev, ids, on));
  const pickCard = (id: string, on: boolean, shift: boolean, order: string[]) => { setIds(shift ? rangeIds(order, lastPick.current, id) : [id], on); lastPick.current = id; };
  const dropTask = async (columnId: string, id: string) => {
    const t = data.find((x) => x.id === id);
    const column = byId.get(columnId);
    if (!t || !column || t.columnId === columnId || !p.canWork || moving.has(id) || blocked(t, columnId)) return;
    let note: string | undefined;
    if (needsMoveNote(columns, t.columnId, columnId, p.sequential)) {
      const r = await promptDialog({ title: `Trả ${t.code} về "${byId.get(columnId)?.name}"?`, label: 'Lý do (thành bình luận của việc)',
        multiline: true, required: true, confirmText: 'Chuyển' });
      if (r === null) return;
      note = r;
    }
    // mutateAsync: mỗi lần thả có promise riêng (callback của mutate chỉ chạy cho lần gọi cuối); toast lỗi đã ở hook.
    move.mutateAsync({ task: t, column, note }).then(() => blink(id, 'ok'), () => blink(id, 'err'));
  };
  const blink = (id: string, kind: 'ok' | 'err') => {
    setFlash((f) => ({ ...f, [id]: kind }));
    setTimeout(() => setFlash(({ [id]: _, ...rest }) => rest), 700);
  };
  const blocked = (t: ITask, columnId: string) => moveBlockReason(columns, t.columnId, columnId, p.sequential, p.canManage);
  const dropColumn = (target: string) => {
    const id = dragCol;
    setDragCol(null);
    if (!id || id === target) return;
    const ids = reorder(columns.map((c) => c.id), id, target);
    setPendingOrder(ids);
    setSavingCol(id);
    reorderCols.mutate(ids, { onError: (err) => toast.error(errorMessage(err)), onSettled: () => { setPendingOrder(null); setSavingCol(null); } });
  };
  const toggleDesc = (columnId: string) => {
    const next = new Set(desc);
    if (!next.delete(columnId)) next.add(columnId);
    setDesc(next);
    try { localStorage.setItem(DESC_KEY, JSON.stringify([...next])); } catch { /* bỏ qua: trình duyệt chặn lưu trữ */ }
  };
  const onDragOver = (e: DragEvent, columnId: string) => {
    const isCol = e.dataTransfer.types.includes(COLUMN);
    if (isCol ? !manage : !p.canWork || (dragTask && blocked(dragTask, columnId))) return;
    e.preventDefault();
    setOver(columnId);
  };
  const onDrop = (e: DragEvent, columnId: string) => {
    setOver(null);
    setDragTask(null);
    if (e.dataTransfer.types.includes(COLUMN)) dropColumn(columnId);
    else void dropTask(columnId, e.dataTransfer.getData(TASK));
  };
  return (
    // Khung của tab Công việc (TEST-192, thiết kế TEST-191 bản 2): nối liền tab đang chọn, vùng công cụ nền `muted`.
    <div className="grid min-w-0 rounded-b-lg border border-t-0" data-testid="task-panel">
      <div className={cn('flex flex-wrap items-center gap-3 bg-muted px-3 pt-3', view === 'list' ? 'pb-2' : 'border-b pb-3')}>
        <ViewToggle view={view} onChange={setView} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={mine} onCheckedChange={(c) => setMine(c === true)} data-testid="only-mine" /> Chỉ việc của tôi</label>
        {!p.canWork && <span className="text-xs text-muted-foreground" data-testid="readonly-hint">
          {p.status === 'Closed' ? (p.canComment ? 'Dự án đã đóng — bạn chỉ bình luận được.' : 'Dự án đã đóng — chỉ xem.') : 'Bạn chỉ xem (không phải thành viên).'}</span>}
        {p.canWork && p.status === 'Closed' && <span className="text-xs text-muted-foreground" data-testid="readonly-hint">Dự án đã đóng — bạn là quản lý nên vẫn sửa được việc.</span>}
        {(p.sequential || columns.some((c) => c.approverOnly)) && <span className="text-xs text-muted-foreground" data-testid="review-hint">
          Quy trình:{p.sequential && ' đi lần lượt từng cột · chuyển lùi phải ghi lý do'}
          {columns.some((c) => c.approverOnly) && `${p.sequential ? ' ·' : ''} chỉ quản lý dự án chuyển sang ${columns.filter((c) => c.approverOnly).map((c) => `"${c.name}"`).join(', ')}`}.
        </span>}
        {manage && view === 'board' && <span className="text-xs text-muted-foreground">Kéo tiêu đề cột để đổi thứ tự.</span>}
        {manage && view === 'board' && <Button size="sm" variant="outline" className="ml-auto" onClick={() => setColEdit(null)}><Plus /> Thêm trạng thái</Button>}
      </div>
      {view === 'list' ? <TaskList d={d} tasks={data} isLoading={isLoading} isError={tasks.isError && !tasks.data} isFetching={tasks.isFetching}
        onRetry={() => void tasks.refetch()} myEmployeeId={myEmployeeId} mine={mine} onMine={setMine} onOpen={(id) => openTask(id)} onHover={hoverTask}
        onCreate={!readOnly && firstCreatable ? () => setCreate({ columnId: firstCreatable.id }) : null} readOnly={readOnly}
        selection={selectable ? { selected, onChange: setSelected } : null} onVisible={keepOnly} />
      : <div ref={board.ref} style={board.height ? { '--board-h': `${board.height}px` } as CSSProperties : undefined}
        className="flex gap-3 overflow-x-auto p-3 xl:h-(--board-h)">
        {columns.map((c) => {
          // API trả theo rank tăng dần → giảm dần chỉ đảo thứ tự hiển thị, rank trong DB giữ nguyên.
          const col = shown.filter((t) => t.columnId === c.id);
          const isDesc = desc.has(c.id);
          if (isDesc) col.reverse();
          const why = dragTask && dragTask.columnId !== c.id ? blocked(dragTask, c.id) : null;
          return (
            <div key={c.id} data-testid={`col-${c.name}`} onDragOver={(e) => onDragOver(e, c.id)} onDragLeave={() => setOver(null)} onDrop={(e) => onDrop(e, c.id)}
              style={{ borderTopColor: c.color }}
              className={cn('group/col flex max-h-[70dvh] min-h-48 w-72 shrink-0 flex-col gap-2 rounded-xl border border-t-4 p-2 xl:max-h-none xl:min-h-0',
                over === c.id ? 'border-x-primary border-b-primary bg-primary/5' : 'bg-muted/30', (dragCol === c.id || why) && 'cursor-not-allowed opacity-50')}
              title={why ?? undefined} data-blocked={why ? '' : undefined}>
              <div className="flex items-center gap-1 px-1 text-sm" draggable={manage} data-testid="column-header"
                onDragStart={(e) => { e.dataTransfer.setData(COLUMN, c.id); e.dataTransfer.effectAllowed = 'move'; setDragCol(c.id); }}
                onDragEnd={() => setDragCol(null)}>
                {manage && <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" aria-hidden />}
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="min-w-0 truncate font-medium" title={c.name}>{c.name}</span>
                <span className="text-muted-foreground">({col.length})</span>
                {savingCol === c.id && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Đang lưu thứ tự" />}
                {c.isDone && <span title="Trạng thái hoàn thành"><CheckCircle2 className="size-3.5 shrink-0 text-success" aria-label="Hoàn thành" /></span>}
                {c.approverOnly && <span title="Cần người duyệt (chỉ quản lý dự án)"><ShieldCheck className="size-3.5 shrink-0 text-warning" aria-label="Cần người duyệt" /></span>}
                <ColumnWakeIcon column={c} members={d.members} onEdit={manage ? () => setColEdit(c) : undefined} />
                <span className="ml-auto flex shrink-0 items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" className={cn('size-7', isDesc && 'text-primary')} aria-pressed={isDesc} data-testid="sort-desc"
                        aria-label={`Sắp xếp ${c.name} ${isDesc ? 'tăng' : 'giảm'} dần`} onClick={() => toggleDesc(c.id)}>
                        {isDesc ? <ArrowDownWideNarrow /> : <ArrowUpNarrowWide />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{isDesc ? 'Đang giảm dần (mới nhất lên đầu) — bấm để xếp tăng dần' : 'Đang tăng dần — bấm để xếp giảm dần (mới nhất lên đầu)'}</TooltipContent>
                  </Tooltip>
                  {selectable && col.length > 0 && <ColumnSelectButton name={c.name} state={checkState(selected, col.map((t) => t.id))}
                    onToggle={(on) => setIds(col.map((t) => t.id), on)} />}
                  {manage && <Button size="icon" variant="ghost" className="size-7" aria-label={`Sửa trạng thái ${c.name}`} onClick={() => setColEdit(c)}><Settings2 /></Button>}
                  {p.canWork && creatable.has(c.id) && <Button size="icon" variant="ghost" className="size-7" aria-label={`Thêm việc vào ${c.name}`}
                    onClick={() => setCreate({ columnId: c.id })}><Plus /></Button>}
                </span>
              </div>
              {why && <p className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground" data-testid="drop-blocked">{why}</p>}
              <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-1">
              {col.map((t) => {
                const order = col.map((x) => x.id);
                return (
                  <KanbanTaskCard key={t.id} t={t} busy={moving.has(t.id)} dragging={dragTask?.id === t.id} flash={flash[t.id]} selected={selected.has(t.id)}
                    selectable={selectable} selectionActive={selected.size > 0} draggable={p.canWork && !moving.has(t.id)} onOpen={() => openTask(t.id)} onHover={(on) => hoverTask(on ? t.id : null)}
                    onDragStart={(e) => { e.dataTransfer.setData(TASK, t.id); e.dataTransfer.effectAllowed = 'move'; setDragTask(t); }}
                    onDragEnd={() => { setDragTask(null); setOver(null); }}
                    onPick={(on, shift) => pickCard(t.id, on, shift, order)} />
                );
              })}
              </div>
            </div>
          );
        })}
      </div>}
      {selectable && <TaskBulkBar d={d} selected={data.filter((t) => selected.has(t.id))} onClear={() => setSelected(new Set())}
        onRemove={(ids) => setSelected((prev) => withIds(prev, ids, false))} />}
      <TaskDialog projectId={p.id} task={opened ?? (create ? null : undefined)} initialColumnId={create?.columnId} columns={columns} members={d.members}
        milestones={d.milestones} canWork={p.canWork} canComment={p.canComment}
        uploadLinks={p.status === 'Active'} canDelete={p.canManage && p.canWork} sequential={p.sequential} focusCommentId={opened ? search.comment : undefined}
        onClose={() => (opened ? openTask(undefined) : setCreate(null))} />
      <ColumnDialog projectId={p.id} column={colEdit} columns={columns} members={d.members} onClose={() => setColEdit(undefined)} />
    </div>
  );
}
