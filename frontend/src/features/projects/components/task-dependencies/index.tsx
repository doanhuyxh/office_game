import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CircleDashed, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { fold } from '@/components/common/SearchSelectField';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTasks } from '../../hooks/useProjects';
import type { ITask, ITaskColumn, ITaskRef } from '../../types/project.types';

const MAX_DEPENDENCIES = 10;
/** Số gợi ý mỗi lần hiện / "Xem thêm". */
const STEP = 15;

/**
 * Thứ tự cột trong gợi ý: việc đang làm → cần làm → chờ review (nhận theo tên cột, không dấu), các cột chưa xong khác
 * theo vị trí gần cột hoàn thành trước (vd Lưu trữ → Không làm); cột hoàn thành cuối cùng (chỉ hiện khi bật "Hiện cả việc đã xong").
 */
const NAME_RANK: [RegExp, number][] = [
  [/dang lam|doing|in progress|dang xu ly|dang thuc hien/, 0],
  [/can lam|to ?do|viec moi|backlog moi/, 1],
  [/review|cho duyet|kiem tra|nghiem thu|testing/, 2],
];
function columnRank(columns: ITaskColumn[]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const c of columns) {
    const byName = c.isDone ? undefined : NAME_RANK.find(([re]) => re.test(fold(c.name)))?.[1];
    // 0–2: theo tên; 100+: cột chưa xong khác, vị trí cao (gần cột xong) trước; 1000+: cột hoàn thành.
    rank.set(c.id, byName ?? (c.isDone ? 1000 + c.position : 100 + (1000 - c.position)));
  }
  return rank;
}

function RefLine({ r, onRemove, removing, busy }: { r: ITaskRef; onRemove?: () => void; removing?: boolean; busy?: boolean }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {/* TEST-199: "đủ" (ready) = đã xong hoặc đã tới cột "Việc sau được bắt đầu từ cột này"; client cũ không có ready → theo done */}
      {(r.ready ?? r.done) ? <CheckCircle2 className={cn('size-4 shrink-0', r.done ? 'text-success' : 'text-info')} /> : <CircleDashed className="size-4 shrink-0 text-warning" />}
      <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
      <span className={r.done ? 'text-muted-foreground line-through' : ''}>{r.title}</span>
      {!r.done && r.ready && <span className="shrink-0 rounded bg-info/15 px-1 text-[10px] font-medium text-info" title="Việc này đã tới trạng thái cho việc sau bắt đầu (chưa xong)"
        data-testid="dependency-ready">Đã cho bắt đầu</span>}
      {onRemove && <Button type="button" size="icon" variant="ghost" className="ml-auto size-6" aria-label={`Bỏ chờ ${r.code}`}
        loading={removing} disabled={busy} onClick={onRemove}><X className="size-3.5" /></Button>}
    </li>
  );
}

/**
 * Việc phải chờ (đủ hết — xong hoặc tới cột "Việc sau được bắt đầu từ cột này", TEST-199 — → người làm nhận thông báo "Sẵn sàng", kể cả bot qua webhook) + việc đang chờ việc này.
 * Ô "Thêm việc phải xong trước" kiểu tìm rồi chọn (TEST-133): gợi ý việc chưa xong (đang làm → cần làm → chờ review → khác, mới nhất trước),
 * gõ mã / tên không dấu (khớp mã xếp trước), 15 dòng + "Xem thêm", không dùng thanh phân trang bảng. Cả dòng là nút, chỉ dòng được bấm xoay;
 * ↑ ↓ Enter, Esc xoá ô tìm. `useTasks` đã tải đủ việc cho kanban nên lọc / sắp ở FE; back-end chặn vòng, việc ngoài dự án, quá 10.
 */
export function TaskDependencies({ projectId, taskId, dependsOn, blocks, canWork, columns }: {
  projectId: string; taskId: string; dependsOn: ITaskRef[]; blocks: ITaskRef[]; canWork: boolean; columns: ITaskColumn[];
}) {
  const tasksQuery = useTasks(projectId);
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [limit, setLimit] = useState(STEP);
  const [active, setActive] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const save = useProjectMutation((ids: string[]) => projectApi.setDependencies(taskId, ids));
  const current = dependsOn.map((d) => d.id);
  const apply = (ids: string[], id: string, onDone?: () => void) => {
    setBusyId(id);
    save.mutate(ids, {
      onSuccess: onDone,
      onError: (e) => toast.error(errorMessage(e)),
      onSettled: () => setBusyId(null),
    });
  };

  const { candidates, matches } = useMemo(() => {
    const rank = columnRank(columns);
    const tasks = tasksQuery.data ?? [];
    const cands = tasks.filter((t) => t.id !== taskId && !current.includes(t.id));
    const kw = fold(q.trim());
    const pool = showDone ? cands : cands.filter((t) => !t.done);
    const byColumn = (a: ITask, b: ITask) =>
      (rank.get(a.columnId) ?? 500) - (rank.get(b.columnId) ?? 500) || b.createdAt.localeCompare(a.createdAt);
    if (!kw) return { candidates: cands, matches: [...pool].sort(byColumn) };
    // Khớp mã trước (đúng mã → đầu mã), rồi khớp tên.
    const score = (t: ITask) => {
      const code = fold(t.code);
      if (code === kw) return 0;
      if (code.startsWith(kw)) return 1;
      if (code.includes(kw)) return 2;
      return fold(t.title).includes(kw) ? 3 : -1;
    };
    const scored = pool.map((t) => ({ t, s: score(t) })).filter((x) => x.s >= 0);
    scored.sort((a, b) => a.s - b.s || byColumn(a.t, b.t));
    return { candidates: cands, matches: scored.map((x) => x.t) };
    // current: mảng mới mỗi lần render — so theo nội dung
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksQuery.data, columns, taskId, current.join(','), q, showDone]);

  const shown = matches.slice(0, limit);
  const idx = Math.max(0, Math.min(active, shown.length - 1));
  const hiddenDone = !showDone ? candidates.filter((t) => t.done).length : 0;

  const add = (t: ITask) => {
    if (save.isPending) return;
    apply([...current, t.id], t.id, () => {
      setActive(0);
      inputRef.current?.focus();
    });
  };
  const optionId = (id: string) => `dep-opt-${taskId}-${id}`;
  const scrollTo = (i: number) => document.getElementById(optionId(shown[i]?.id ?? ''))?.scrollIntoView({ block: 'nearest' });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' && shown.length) { e.preventDefault(); const i = (idx + 1) % shown.length; setActive(i); scrollTo(i); }
    else if (e.key === 'ArrowUp' && shown.length) { e.preventDefault(); const i = (idx - 1 + shown.length) % shown.length; setActive(i); scrollTo(i); }
    else if (e.key === 'Enter') {
      e.preventDefault(); // nằm trong form của hộp thoại việc: Enter không được lưu + đóng
      if (shown[idx]) add(shown[idx]);
    }
  };
  // Esc trong ô tìm còn chữ → chỉ xoá ô tìm, không đóng hộp thoại. Radix Dialog nghe Esc ở capture của document
  // nên phải chặn sớm hơn: capture trên window.
  const hasQuery = q.length > 0;
  useEffect(() => {
    if (!hasQuery) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.target !== inputRef.current) return;
      e.stopPropagation(); e.preventDefault();
      setQ(''); setActive(0); setLimit(STEP);
    };
    window.addEventListener('keydown', onEsc, { capture: true });
    return () => window.removeEventListener('keydown', onEsc, { capture: true });
  }, [hasQuery]);

  if (!dependsOn.length && !blocks.length && !canWork) return null;
  const listId = `dep-list-${taskId}`;
  return (
    <div className="grid gap-2 border-t pt-3" data-testid="task-dependencies">
      <div className="text-sm font-medium">Phải chờ việc ({dependsOn.length})</div>
      {dependsOn.length > 0
        ? <ul className="grid gap-1">{dependsOn.map((r) => (
            <RefLine key={r.id} r={r} removing={busyId === r.id} busy={save.isPending}
              onRemove={canWork ? () => apply(current.filter((x) => x !== r.id), r.id) : undefined} />
          ))}</ul>
        : <p className="text-xs text-muted-foreground">Không chờ việc nào — bắt đầu được ngay.</p>}
      {canWork && candidates.length > 0 && current.length < MAX_DEPENDENCIES && (
        <div className="grid gap-2" data-testid="dependency-picker">
          <Label htmlFor={`dep-q-${taskId}`}>Thêm việc phải xong trước</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input ref={inputRef} id={`dep-q-${taskId}`} className="pl-8" placeholder="Tìm mã hoặc tên việc…" value={q}
              role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={shown[idx] ? optionId(shown[idx].id) : undefined}
              onChange={(e) => { setQ(e.target.value); setActive(0); setLimit(STEP); }} onKeyDown={onKeyDown} />
          </div>
          <div className="overflow-hidden rounded-md border">
            <div id={listId} role="listbox" aria-label="Việc gợi ý" className="max-h-72 overflow-y-auto overscroll-contain p-1" data-testid="dependency-list">
              {shown.map((t, i) => (
                <Button key={t.id} id={optionId(t.id)} type="button" variant="ghost" role="option" aria-selected={i === idx} tabIndex={-1}
                  title={`${t.code} · ${t.title}`} data-testid="dependency-candidate" data-code={t.code}
                  loading={busyId === t.id} disabled={save.isPending}
                  className={cn('group h-auto min-h-10 w-full justify-start gap-2 px-2 py-1.5 text-left font-normal whitespace-normal max-sm:min-h-11',
                    i === idx && 'bg-accent text-accent-foreground')}
                  onMouseEnter={() => setActive(i)} onClick={() => add(t)}>
                  <Plus className={cn('size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-loading:opacity-100',
                    i === idx && 'opacity-100')} aria-hidden />
                  <span className="shrink-0 self-start pt-px font-mono text-xs font-semibold">{t.code}</span>
                  <span className={cn('line-clamp-2 min-w-0 flex-1 text-sm', t.done && 'text-muted-foreground line-through')}>{t.title}</span>
                  <span className="flex max-w-24 shrink-0 items-center gap-1 self-start pt-0.5 text-[11px] text-muted-foreground">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.columnColor }} aria-hidden />
                    <span className="truncate">{t.columnName}</span>
                  </span>
                </Button>
              ))}
              {shown.length === 0 && (
                <p className="px-2 py-2 text-sm text-muted-foreground" data-testid="dependency-empty">
                  Không có việc phù hợp{q.trim() ? ` với "${q.trim()}"` : ''}.
                  {hiddenDone > 0 && ' Bật "Hiện cả việc đã xong" để tìm trong việc đã xong.'}
                </p>
              )}
              {matches.length > shown.length && (
                <Button type="button" variant="ghost" size="sm" className="w-full text-primary" data-testid="dependency-more"
                  onClick={() => setLimit((n) => n + STEP)}>
                  Xem thêm {Math.min(STEP, matches.length - shown.length)} việc ({matches.length - shown.length} còn lại)
                </Button>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-2 border-t px-2 py-1.5 text-xs text-muted-foreground">
              <Checkbox checked={showDone} onCheckedChange={(v) => { setShowDone(v === true); setActive(0); setLimit(STEP); }}
                data-testid="dependency-show-done" />
              Hiện cả việc đã xong{hiddenDone > 0 ? ` (${hiddenDone})` : ''}
            </label>
          </div>
        </div>
      )}
      {blocks.length > 0 && (
        <>
          <div className="text-sm font-medium">Đang chờ việc này ({blocks.length})</div>
          <ul className="grid gap-1">{blocks.map((r) => <RefLine key={r.id} r={r} />)}</ul>
        </>
      )}
    </div>
  );
}
