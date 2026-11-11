import { useState } from 'react';
import { CheckCircle2, CircleDashed, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTasks } from '../../hooks/useProjects';
import type { ITaskRef } from '../../types/project.types';

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
 * Thành viên sửa danh sách; back-end chặn vòng, việc ngoài dự án, quá 10.
 */
export function TaskDependencies({ projectId, taskId, dependsOn, blocks, canWork }: {
  projectId: string; taskId: string; dependsOn: ITaskRef[]; blocks: ITaskRef[]; canWork: boolean;
}) {
  const tasks = useTasks(projectId).data ?? [];
  const [adding, setAdding] = useState<string | null>(null);
  const save = useProjectMutation((ids: string[]) => projectApi.setDependencies(taskId, ids));
  const apply = (ids: string[]) => save.mutate(ids, { onSuccess: () => setAdding(null), onError: (e) => toast.error(errorMessage(e)) });
  const current = dependsOn.map((d) => d.id);
  const options = tasks.filter((t) => t.id !== taskId && !current.includes(t.id)).map((t) => ({ value: t.id, label: `${t.code} · ${t.title}` }));
  if (!dependsOn.length && !blocks.length && !canWork) return null;
  return (
    <div className="grid gap-2 border-t pt-3" data-testid="task-dependencies">
      <div className="text-sm font-medium">Phải chờ việc ({dependsOn.length})</div>
      {dependsOn.length > 0
        ? <ul className="grid gap-1">{dependsOn.map((r) => <RefLine key={r.id} r={r} onRemove={canWork ? () => apply(current.filter((x) => x !== r.id)) : undefined} />)}</ul>
        : <p className="text-xs text-muted-foreground">Không chờ việc nào — bắt đầu được ngay.</p>}
      {canWork && options.length > 0 && current.length < 10 && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SelectField id={`dep-${taskId}`} label="Thêm việc phải xong trước" allowEmpty emptyLabel="— Chọn việc —" value={adding} onChange={setAdding} options={options} />
          </div>
          <Button type="button" size="sm" disabled={!adding || save.isPending} onClick={() => adding && apply([...current, adding])}>Thêm</Button>
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
