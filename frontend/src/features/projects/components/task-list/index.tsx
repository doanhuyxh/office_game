import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMutationState } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, ChevronDown, ChevronRight, Eye, FilterX, Loader2, MessageSquare, Plus, Search, SearchX, User } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { promptDialog } from '@/components/common/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { Input } from '@/components/common/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/common/select';
import { Skeleton } from '@/components/common/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/common/tooltip';
import { fmtDate } from '@/features/finance';
import { cn } from '@/utils/cn';
import { todayVn } from '@/utils/date';
import { moveTaskKey, useMoveTask, useTaskDetail, type IMoveTaskArgs } from '../../hooks/useProjects';
import type { IProjectDetail, ITask, ITaskColumn } from '../../types/project.types';
import { moveBlockReason, needsMoveNote } from '../../utils/labels';
import { checkState, rangeIds, withIds } from '../../utils/task-bulk';
import {
  DUE_LABEL, EMPTY_FILTER, GROUP_LABEL, SORT_LABEL, filterTasks, groupTasks, isFiltered, sortTasks,
  type ITaskGroup, type ITaskListFilter, type TaskDueFilter, type TaskGroupBy, type TaskSort,
} from '../../utils/task-list';
import { ColumnBadge } from '../column-badge';

/** Số cột của bảng không tính ô tích chọn (dòng nhóm / trống / đang tải trải hết = COLS + 1 khi có ô tích). */
const COLS = 7;

interface Props {
  d: IProjectDetail;
  tasks: ITask[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  myEmployeeId: string | null;
  mine: boolean;
  onMine: (v: boolean) => void;
  /** Mở hộp thoại chi tiết việc (`?task=<id>` như bảng kanban). */
  onOpen: (id: string) => void;
  /** null = không có nút "Tạo công việc" (chỉ xem / không cột nào tạo được). */
  onCreate: (() => void) | null;
  /** Chỉ xem: trạng thái là nhãn tĩnh. */
  readOnly: boolean;
  /** Tập việc đang chọn cho thao tác hàng loạt (state ở `TaskBoard`, dùng chung với kanban). null = không có ô tích (chỉ xem). */
  selection: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void } | null;
  /** Báo danh sách id đang hiện theo bộ lọc — `TaskBoard` bỏ chọn việc không còn hiện (lựa chọn gắn với bộ lọc như danh sách nhân viên). */
  onVisible: (ids: string[]) => void;
}

/**
 * Chế độ xem "Danh sách" của tab Công việc (TEST-192, thiết kế TEST-191 bản 2): lọc / nhóm / sắp xếp / tìm ở client trên dữ liệu `useTasks`
 * (không API mới, không phân trang). Vùng nội dung ≥ 56rem: bảng; hẹp hơn: mỗi việc một thẻ nhiều dòng. Nhóm theo trạng thái theo đúng
 * thứ tự cột của dự án, nhóm của cột hoàn thành thu gọn sẵn. Đổi trạng thái trên dòng: menu chỉ gồm cột được phép (`moveBlockReason`),
 * lùi hỏi lý do (`needsMoveNote`), lưu qua `useMoveTask` (optimistic, lỗi → trả về cột cũ + toast) — cùng quy tắc với kanban.
 */
export function TaskList({ d, tasks, isLoading, isError, isFetching, onRetry, myEmployeeId, mine, onMine, onOpen, onCreate, readOnly, selection, onVisible }: Props) {
  const p = d.project;
  const columns = d.columns;
  const [filter, setFilter] = useState<ITaskListFilter>({ ...EMPTY_FILTER, mine });
  const [groupBy, setGroupBy] = useState<TaskGroupBy>('status');
  const [sort, setSort] = useState<TaskSort>('rank');
  /** Nhóm người dùng đã bấm mở / thu (ghi đè mặc định: nhóm hoàn thành thu, nhóm khác mở). */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const move = useMoveTask(p.id);
  const moving = new Set(useMutationState({ filters: { mutationKey: moveTaskKey(p.id), status: 'pending' },
    select: (m) => (m.state.variables as IMoveTaskArgs | undefined)?.task.id }));
  const set = (patch: Partial<ITaskListFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    if (patch.mine !== undefined) onMine(patch.mine);
  };
  const f = { ...filter, mine };
  const today = todayVn();
  const shown = sortTasks(filterTasks(tasks, f, myEmployeeId, today), sort);
  const groups = groupTasks(shown, groupBy, columns, d.members, today, !isFiltered(f));
  const open = (g: ITaskGroup) => toggled[g.key] ?? !g.isDone;
  // Thao tác hàng loạt (ô tích): chọn theo dòng đang hiện (nhóm thu gọn không tính vào ô tích tổng), Shift+click chọn dải.
  const sel = selection?.selected;
  const cols = selection ? COLS + 1 : COLS;
  const order = groups.filter((g) => groupBy === 'none' || open(g)).flatMap((g) => g.tasks.map((t) => t.id));
  const lastPick = useRef<string | null>(null);
  const setIds = (ids: string[], on: boolean) => { if (selection) selection.onChange(withIds(selection.selected, ids, on)); };
  const pick = (id: string, on: boolean, shift: boolean) => { setIds(shift ? rangeIds(order, lastPick.current, id) : [id], on); lastPick.current = id; };
  const visibleKey = shown.map((t) => t.id).join(',');
  useEffect(() => { if (!isLoading) onVisible(visibleKey ? visibleKey.split(',') : []); }, [visibleKey, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (g: ITaskGroup) => setToggled((t) => ({ ...t, [g.key]: !open(g) }));
  const clear = () => { setFilter(EMPTY_FILTER); onMine(false); };

  const changeStatus = async (t: ITask, column: ITaskColumn) => {
    let note: string | undefined;
    if (needsMoveNote(columns, t.columnId, column.id, p.sequential)) {
      const r = await promptDialog({ title: `Trả ${t.code} về "${column.name}"?`, label: 'Lý do (thành bình luận của việc)',
        multiline: true, required: true, confirmText: 'Chuyển' });
      if (r === null) return;
      note = r;
    }
    move.mutateAsync({ task: t, column, note }).catch(() => { /* hook đã trả việc về cột cũ + toast lỗi */ });
  };
  const targets = (t: ITask) => columns.filter((c) => c.id !== t.columnId && !moveBlockReason(columns, t.columnId, c.id, p.sequential, p.canManage));
  const status = (t: ITask) => <StatusCell t={t} targets={readOnly ? [] : targets(t)} busy={moving.has(t.id)} onPick={(c) => void changeStatus(t, c)} />;

  const memberOptions = d.members.filter((m) => m.isActive || tasks.some((t) => t.assigneeEmployeeId === m.employeeId));
  const empty = !isLoading && !isError && shown.length === 0;
  const tableHead = <>
    <colgroup>
      {selection && <col className="w-10" />}<col /><col className="w-36" /><col className="w-40" /><col className="w-24" /><col className="w-36" /><col className="w-24" /><col className="w-24" />
    </colgroup>
    <TableHeader className="bg-muted/40 text-xs uppercase">
      <TableRow>
        {selection && <TableHead className="w-10"><Checkbox checked={checkState(sel!, order)} disabled={order.length === 0} aria-label="Chọn tất cả việc đang hiện"
          onCheckedChange={(c) => setIds(order, c === true)} data-testid="task-check-all" /></TableHead>}
        <TableHead>Việc</TableHead><TableHead>Trạng thái</TableHead><TableHead>Người làm</TableHead><TableHead>Theo dõi</TableHead>
        <TableHead>Hạn</TableHead><TableHead className="text-right">Ước lượng</TableHead><TableHead className="text-right">Bình luận</TableHead>
      </TableRow>
    </TableHeader>
  </>;
  return (
    <div className="grid min-w-0" data-testid="task-list">
      {/* Vùng công cụ nền `muted` nối tiếp hàng Cột / Danh sách của TaskBoard (thiết kế TEST-191 bản 2) */}
      <div className="grid gap-2 border-b bg-muted px-3 pb-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" data-testid="task-list-filters">
        <FilterSelect label="Trạng thái" value={f.columnId} onChange={(columnId) => set({ columnId })} testId="filter-status"
          options={[{ value: 'all', label: 'Tất cả' }, ...columns.map((c) => ({ value: c.id, label: c.name }))]} />
        <FilterSelect label="Người làm" value={f.assignee} onChange={(assignee) => set({ assignee })} testId="filter-assignee"
          options={[{ value: 'all', label: 'Tất cả' }, { value: 'none', label: 'Chưa giao' }, ...memberOptions.map((m) => ({ value: m.employeeId, label: m.fullName }))]} />
        <FilterSelect label="Hạn" value={f.due} onChange={(due) => set({ due: due as TaskDueFilter })} testId="filter-due"
          options={Object.entries(DUE_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect label="Nhóm theo" value={groupBy} onChange={(v) => setGroupBy(v as TaskGroupBy)} testId="group-by"
          options={Object.entries(GROUP_LABEL).map(([value, label]) => ({ value, label }))} />
        <FilterSelect label="Sắp xếp" value={sort} onChange={(v) => setSort(v as TaskSort)} testId="sort-by"
          options={Object.entries(SORT_LABEL).map(([value, label]) => ({ value, label }))} />
        {isFiltered(f) && <Button size="sm" variant="ghost" onClick={clear} data-testid="clear-filters"><FilterX /> Xoá bộ lọc</Button>}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={filter.search} onChange={(e) => set({ search: e.target.value })} placeholder="Tìm theo mã hoặc tên việc…" className="h-8 pl-8"
            aria-label="Tìm công việc" data-testid="task-search" />
        </div>
        {onCreate && <Button size="sm" className="ml-auto shrink-0" onClick={onCreate} data-testid="list-create-task" aria-label="Tạo công việc">
          <Plus /> <span className="hidden sm:inline">Tạo công việc</span><span className="sm:hidden">Tạo</span></Button>}
      </div>
      </div>

      {isError ? <div className="p-3"><ListError onRetry={onRetry} retrying={isFetching} /></div>
        : empty ? <>
          {/* Trống: giữ hàng tiêu đề bảng (vùng rộng), thông báo nằm trong khung, dòng đếm ở chân (ảnh danh-sach-trong-v2) */}
          <div className="hidden @4xl/content:block"><Table className="table-fixed">{tableHead}</Table></div>
          <ListEmpty filtered={isFiltered(f)} onClear={clear} />
        </>
        : <>
          {/* Vùng nội dung rộng: bảng */}
          <div className="hidden @4xl/content:block">
            <Table className="table-fixed" data-testid="task-table">
              {tableHead}
              <TableBody>
                {isLoading ? Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i} data-testid="task-row-skeleton">
                    {Array.from({ length: cols }, (__, j) => <TableCell key={j}><Skeleton className={cn('h-4', j === (selection ? 1 : 0) ? 'w-4/5' : 'w-16')} /></TableCell>)}
                  </TableRow>
                )) : groups.map((g) => (
                  <GroupRows key={g.key} g={g} open={open(g)} onToggle={groupBy === 'none' ? undefined : () => toggle(g)} cols={cols}
                    check={selection ? <GroupCheck g={g} sel={sel!} onChange={setIds} /> : undefined}>
                    {g.tasks.map((t) => (
                      <TableRow key={t.id} className={cn('cursor-pointer', moving.has(t.id) && 'opacity-80')} tabIndex={0} data-testid="task-row"
                        data-task={t.code} data-selected={sel?.has(t.id) ? '' : undefined} onClick={() => onOpen(t.id)} onKeyDown={rowKey(() => onOpen(t.id))}>
                        {selection && <TableCell className="w-10" onClick={(e) => e.stopPropagation()}><RowCheck t={t} checked={sel!.has(t.id)} onPick={pick} /></TableCell>}
                        <TableCell className="min-w-0"><TaskTitle t={t} /></TableCell>
                        <TableCell>{status(t)}</TableCell>
                        <TableCell className="truncate" title={t.assigneeName ?? undefined}>
                          {t.assigneeName ?? <span className="text-muted-foreground">Chưa giao</span>}
                        </TableCell>
                        <TableCell><Followers t={t} /></TableCell>
                        <TableCell><Due t={t} /></TableCell>
                        <TableCell className="text-right text-muted-foreground">{t.estimateDays != null ? `${t.estimateDays} ngày` : ''}</TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {t.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" />{t.commentCount}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </GroupRows>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Vùng hẹp (điện thoại, máy tính bảng): thẻ nhiều dòng, không cuộn ngang */}
          <div className="grid gap-3 p-3 @4xl/content:hidden" data-testid="task-cards">
            {isLoading ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 w-full rounded-lg" />)
              : groups.map((g) => (
                <section key={g.key} className="grid gap-2" data-testid="task-group" data-group={g.label}>
                  {groupBy !== 'none' && <div className="flex min-w-0 items-center gap-2">
                    {selection && <GroupCheck g={g} sel={sel!} onChange={setIds} />}
                    <div className="min-w-0 flex-1"><GroupHeader g={g} open={open(g)} onToggle={() => toggle(g)} /></div>
                  </div>}
                  {open(g) && g.tasks.map((t) => (
                    <div key={t.id} role="button" tabIndex={0} onClick={() => onOpen(t.id)} onKeyDown={rowKey(() => onOpen(t.id))} data-testid="task-card-row"
                      data-task={t.code} data-selected={sel?.has(t.id) ? '' : undefined}
                      className={cn('grid min-w-0 cursor-pointer gap-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs hover:border-primary/50', moving.has(t.id) && 'opacity-80', sel?.has(t.id) && 'border-primary/60 bg-primary/5')}>
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        {selection && <span onClick={(e) => e.stopPropagation()}><RowCheck t={t} checked={sel!.has(t.id)} onPick={pick} /></span>}
                        <TaskMeta t={t} />
                        <div className="shrink-0">{status(t)}</div>
                      </div>
                      <div className={cn('break-words', t.done ? 'text-muted-foreground line-through' : 'font-medium')}>{t.title}</div>
                      <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex min-w-0 items-center gap-1"><User className="size-3.5 shrink-0" /><span className="truncate">{t.assigneeName ?? 'Chưa giao'}</span></span>
                        <Followers t={t} />
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><CalendarDays className="size-3.5" /><Due t={t} /></span>
                        <span className="flex items-center gap-3">
                          {t.estimateDays != null && <span>{t.estimateDays} ngày</span>}
                          {t.commentCount > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="size-3.5" />{t.commentCount}</span>}
                        </span>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
          </div>
        </>}
      {!isLoading && !isError && <p className="rounded-b-lg border-t bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="task-list-count">
        Hiển thị {shown.length} / {tasks.length} công việc{groupBy !== 'none' && shown.length > 0 && ` · ${groups.length} nhóm`}
      </p>}
    </div>
  );
}

/** Enter / Space trên dòng = bấm (dòng là phần tử bấm được bằng bàn phím). */
const rowKey = (fn: () => void) => (e: KeyboardEvent) => {
  if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  fn();
};

/** Ô chọn gọn "Nhãn: Giá trị" trên hàng lọc. */
function FilterSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; testId: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full min-w-0 justify-start gap-1 sm:w-fit sm:max-w-56 [&>svg:last-child]:ml-auto" aria-label={label} data-testid={testId}>
        <span className="shrink-0 text-muted-foreground">{label}:</span>
        <SelectValue className="block! min-w-0 truncate" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function GroupHeader({ g, open, onToggle }: { g: ITaskGroup; open: boolean; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} data-testid="group-header"
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
      <Icon className="size-4 shrink-0" />
      {g.color && <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />}
      <span className="truncate">{g.label}</span>
      <span className="rounded-full bg-muted px-1.5 font-medium normal-case">{g.tasks.length}</span>
      {g.isDone && !open && g.tasks.length > 0 && <span className="ml-auto truncate font-normal normal-case">Đã thu gọn · bấm để xem</span>}
    </button>
  );
}

/** Dòng tiêu đề nhóm (bấm để mở / thu) + các dòng việc khi đang mở. Không nhóm → chỉ các dòng. */
function GroupRows({ g, open, onToggle, cols, check, children }: { g: ITaskGroup; open: boolean; onToggle?: () => void; cols: number; check?: ReactNode; children: ReactNode }) {
  if (!onToggle) return <>{children}</>;
  return (
    <>
      <TableRow className="bg-muted/30 hover:bg-muted/50" data-testid="task-group" data-group={g.label}>
        {check && <TableCell className="w-10 py-1">{check}</TableCell>}
        <TableCell colSpan={check ? cols - 1 : cols} className="py-1"><GroupHeader g={g} open={open} onToggle={onToggle} /></TableCell>
      </TableRow>
      {open && children}
    </>
  );
}

/** Ô tích chọn một việc (Shift+click = chọn cả dải từ lần tích trước). */
function RowCheck({ t, checked, onPick }: { t: ITask; checked: boolean; onPick: (id: string, on: boolean, shift: boolean) => void }) {
  return <Checkbox checked={checked} aria-label={`Chọn ${t.code}`} data-testid="task-check" onCheckedChange={() => { /* xử lý ở onClick để biết phím Shift */ }}
    onClick={(e) => { e.stopPropagation(); onPick(t.id, !checked, e.shiftKey); }} />;
}

/** Ô tích cả nhóm (true / một phần / không). */
function GroupCheck({ g, sel, onChange }: { g: ITaskGroup; sel: ReadonlySet<string>; onChange: (ids: string[], on: boolean) => void }) {
  const ids = g.tasks.map((t) => t.id);
  return <Checkbox checked={checkState(sel, ids)} disabled={ids.length === 0} aria-label={`Chọn cả nhóm ${g.label}`} data-testid="group-check"
    onCheckedChange={(c) => onChange(ids, c === true)} />;
}

function TaskMeta({ t }: { t: ITask }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span className="font-medium">{t.code}</span>
      {t.createdByBot && <BotBadge />}
      {!!t.waitingOn && !t.done && <span className="rounded bg-warning/15 px-1 text-[10px] font-medium text-warning" title="Còn chờ việc khác chưa xong / chưa tới trạng thái cho việc sau bắt đầu"
        data-testid="task-waiting">Chờ {t.waitingOn} việc</span>}
    </span>
  );
}

function TaskTitle({ t }: { t: ITask }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{t.code}</span>
      <span className={cn('min-w-0 truncate', t.done ? 'text-muted-foreground line-through' : 'font-medium')} title={t.title}>{t.title}</span>
      {t.createdByBot && <BotBadge className="shrink-0" />}
      {!!t.waitingOn && !t.done && <span className="shrink-0 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning" title="Còn chờ việc khác chưa xong / chưa tới trạng thái cho việc sau bắt đầu"
        data-testid="task-waiting">Chờ {t.waitingOn} việc</span>}
    </div>
  );
}

function Due({ t }: { t: ITask }) {
  if (!t.dueOn) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5', t.overdue && 'text-destructive')} data-overdue={t.overdue ? '' : undefined}>
      {fmtDate(t.dueOn)}
      {t.overdue && <span className="rounded bg-destructive/10 px-1 text-[10px] font-medium" data-testid="task-overdue">Quá hạn</span>}
    </span>
  );
}

/** 👁 + số người theo dõi (0 → trống). Rê chuột: tên lấy từ chi tiết việc (tải lúc mở tooltip, không thêm trường vào API danh sách). */
function Followers({ t }: { t: ITask }) {
  const n = t.followerCount ?? 0;
  if (n === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-muted-foreground" data-testid="task-followers" onClick={(e) => e.stopPropagation()}>
          <Eye className="size-3.5" aria-label="Người theo dõi" />{n}
        </span>
      </TooltipTrigger>
      <TooltipContent><FollowerNames taskId={t.id} /></TooltipContent>
    </Tooltip>
  );
}

function FollowerNames({ taskId }: { taskId: string }) {
  const { data, isLoading } = useTaskDetail(taskId);
  if (isLoading) return <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Đang tải…</span>;
  const names = (data?.followers ?? []).map((x) => x.fullName);
  return <span data-testid="follower-names">{names.length ? `Theo dõi: ${names.join(', ')}` : 'Không có người theo dõi'}</span>;
}

/** Nhãn trạng thái: có cột chuyển được → menu (chỉ các cột được phép); không → nhãn tĩnh. Đang lưu → vòng xoay. */
function StatusCell({ t, targets, busy, onPick }: { t: ITask; targets: ITaskColumn[]; busy: boolean; onPick: (c: ITaskColumn) => void }) {
  const badge = <ColumnBadge name={t.columnName} color={t.columnColor} className="max-w-full min-w-0 bg-background [&>span:last-child]:truncate" />;
  if (busy) return <span className="inline-flex max-w-full items-center gap-1" aria-busy data-testid="task-status-saving">
    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Đang lưu" />{badge}</span>;
  if (targets.length === 0) return <span className="inline-flex max-w-full" data-testid="task-status-static">{badge}</span>;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-testid="task-status-menu"
          aria-label={`Đổi trạng thái ${t.code} (đang ${t.columnName})`}
          className="inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-full hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {badge}<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Chuyển sang</DropdownMenuLabel>
        {targets.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onPick(c)} data-testid="task-status-option">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />{c.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ListEmpty({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-16 text-center" data-testid="task-list-empty">
      <span className="grid size-14 place-items-center rounded-full border bg-muted"><SearchX className="size-6 text-muted-foreground" aria-hidden /></span>
      <p className="font-medium">{filtered ? 'Không tìm thấy công việc' : 'Chưa có công việc'}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {filtered ? 'Thử đổi bộ lọc hoặc tìm với từ khoá khác để thấy công việc bạn cần.' : 'Dự án này chưa có công việc nào.'}
      </p>
      {filtered && <Button size="sm" className="mt-1" onClick={onClear}><FilterX /> Xoá bộ lọc</Button>}
    </div>
  );
}

function ListError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-12 text-center" role="alert" data-testid="task-list-error">
      <AlertCircle className="size-8 text-destructive" aria-hidden />
      <p className="font-medium">Không tải được công việc</p>
      <p className="max-w-sm text-sm text-muted-foreground">Kiểm tra kết nối mạng rồi thử lại.</p>
      <Button size="sm" variant="outline" onClick={onRetry} loading={retrying} loadingText="Đang tải…">Thử lại</Button>
    </div>
  );
}
