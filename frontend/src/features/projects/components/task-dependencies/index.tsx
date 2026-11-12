import { useState } from 'react';
import { CheckCircle2, CircleDashed, Plus, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { fold } from '@/components/common/SearchSelectField';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTasks } from '../../hooks/useProjects';
import type { ITaskRef } from '../../types/project.types';
import { ColumnBadge } from '../column-badge';

const MAX_DEPENDENCIES = 10;
const taskNumber = (code: string) => Number(code.slice(code.lastIndexOf('-') + 1));

function RefLine({ r, onRemove }: { r: ITaskRef; onRemove?: () => void }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {r.done ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <CircleDashed className="size-4 shrink-0 text-warning" />}
      <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
      <span className={r.done ? 'text-muted-foreground line-through' : ''}>{r.title}</span>
      {onRemove && <Button type="button" size="icon" variant="ghost" className="ml-auto size-6" aria-label={`Bỏ chờ ${r.code}`} onClick={onRemove}><X className="size-3.5" /></Button>}
    </li>
  );
}

/**
 * Việc phải chờ (xong hết → người làm nhận thông báo "Sẵn sàng", kể cả bot qua webhook) + việc đang chờ việc này.
 * Thành viên thêm từ danh sách việc của dự án (tìm theo mã / tên không phân biệt dấu, phân trang ở FE — `useTasks` đã tải đủ cho kanban);
 * back-end chặn vòng, việc ngoài dự án, quá 10.
 */
export function TaskDependencies({ projectId, taskId, dependsOn, blocks, canWork }: {
  projectId: string; taskId: string; dependsOn: ITaskRef[]; blocks: ITaskRef[]; canWork: boolean;
}) {
  const tasks = useTasks(projectId).data ?? [];
  const [q, setQ] = useState('');
  const pg = usePageState('task-dependencies', q, 10);
  const save = useProjectMutation((ids: string[]) => projectApi.setDependencies(taskId, ids));
  const apply = (ids: string[]) => save.mutate(ids, { onError: (e) => toast.error(errorMessage(e)) });
  const current = dependsOn.map((d) => d.id);
  const candidates = tasks.filter((t) => t.id !== taskId && !current.includes(t.id)).sort((a, b) => taskNumber(a.code) - taskNumber(b.code));
  const kw = fold(q.trim());
  const matches = kw ? candidates.filter((t) => fold(`${t.code} ${t.title}`).includes(kw)) : candidates;
  const pageRows = matches.slice((pg.page - 1) * pg.pageSize, pg.page * pg.pageSize);
  if (!dependsOn.length && !blocks.length && !canWork) return null;
  return (
    <div className="grid gap-2 border-t pt-3" data-testid="task-dependencies">
      <div className="text-sm font-medium">Phải chờ việc ({dependsOn.length})</div>
      {dependsOn.length > 0
        ? <ul className="grid gap-1">{dependsOn.map((r) => <RefLine key={r.id} r={r} onRemove={canWork ? () => apply(current.filter((x) => x !== r.id)) : undefined} />)}</ul>
        : <p className="text-xs text-muted-foreground">Không chờ việc nào — bắt đầu được ngay.</p>}
      {canWork && candidates.length > 0 && current.length < MAX_DEPENDENCIES && (
        <div className="grid gap-2" data-testid="dependency-picker">
          <Label htmlFor={`dep-q-${taskId}`}>Thêm việc phải xong trước</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id={`dep-q-${taskId}`} className="pl-8" placeholder="Tìm mã hoặc tên việc…" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} /* nằm trong form của hộp thoại việc: Enter không được lưu + đóng */ />
          </div>
          <div className="overflow-hidden rounded-md border">
            {pageRows.length > 0
              ? <ul className="divide-y">
                  {pageRows.map((t) => (
                    <li key={t.id} className="flex items-center gap-2 px-2 py-1.5" data-testid="dependency-candidate">
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.code}</span>
                          <ColumnBadge name={t.columnName} color={t.columnColor} className="min-w-0" />
                        </div>
                        <span className={`truncate text-sm ${t.done ? 'text-muted-foreground line-through' : ''}`} title={t.title}>{t.title}</span>
                      </div>
                      <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0" disabled={save.isPending} aria-label={`Thêm chờ ${t.code}`}
                        onClick={() => apply([...current, t.id])}><Plus /> Thêm</Button>
                    </li>
                  ))}
                </ul>
              : <p className="px-3 py-2 text-sm text-muted-foreground">Không có việc nào khớp "{q.trim()}".</p>}
            <TablePagination state={pg} total={matches.length} unit="việc" className="px-2" />
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
