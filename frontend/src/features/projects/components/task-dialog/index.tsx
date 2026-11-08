import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useComments, useProjectMutation } from '../../hooks/useProjects';
import type { IMember, IMilestone, ITask, ITaskRequest, TaskState } from '../../types/project.types';
import { TASK_STATE, TASK_STATES } from '../../utils/labels';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Thêm / sửa việc + bình luận. `task`: undefined = đóng, null = thêm mới (trạng thái `initialState`). */
export function TaskDialog({ projectId, task, initialState = 'Todo', members, milestones, canWork, canDelete, onClose }: {
  projectId: string; task: ITask | null | undefined; initialState?: TaskState; members: IMember[]; milestones: IMilestone[]; canWork: boolean; canDelete: boolean; onClose: () => void;
}) {
  const open = task !== undefined;
  const [f, setF] = useState<ITaskRequest>({ title: '', state: 'Todo' });
  const [comment, setComment] = useState('');
  const save = useProjectMutation((b: ITaskRequest): Promise<unknown> => (task ? projectApi.updateTask(task.id, b) : projectApi.createTask(projectId, b)));
  const remove = useProjectMutation(projectApi.deleteTask);
  const addComment = useProjectMutation((c: string) => projectApi.addComment(task!.id, c));
  const comments = useComments(task?.id ?? null).data ?? [];
  useEffect(() => {
    if (!open) return;
    save.reset(); setComment('');
    setF(task ? { title: task.title, description: task.description ?? '', state: task.state, assigneeEmployeeId: task.assigneeEmployeeId, milestoneId: task.milestoneId,
      dueOn: task.dueOn ?? '', estimateDays: task.estimateDays } : { title: '', description: '', state: initialState, assigneeEmployeeId: null, milestoneId: null, dueOn: '', estimateDays: null });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, task?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ITaskRequest>(k: K, v: ITaskRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{task ? `${task.code} · ${task.title}` : 'Thêm việc'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, dueOn: f.dueOn || null, description: f.description || null }, {
            onSuccess: () => { toast.success('Đã lưu việc'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <fieldset disabled={!canWork} className="grid gap-3">
            <FormField id="tk-title" label="Tên việc *" required autoFocus maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
            <div className="grid gap-2"><Label htmlFor="tk-desc">Mô tả</Label>
              <Textarea id="tk-desc" rows={3} maxLength={5000} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField id="tk-state" label="Trạng thái" value={f.state} onChange={(v) => set('state', (v ?? 'Todo') as TaskState)} options={TASK_STATES.map((s) => ({ value: s, label: TASK_STATE[s].label }))} />
              <SelectField id="tk-who" label="Người làm" allowEmpty emptyLabel="— Chưa giao —" value={f.assigneeEmployeeId ?? null} onChange={(v) => set('assigneeEmployeeId', v)}
                options={members.filter((m) => m.isActive).map((m) => ({ value: m.employeeId, label: m.fullName }))} error={errors.assigneeEmployeeId} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FormField id="tk-due" label="Hạn" type="date" value={f.dueOn ?? ''} onChange={(e) => set('dueOn', e.target.value)} />
              <FormField id="tk-est" label="Ước lượng (ngày)" type="number" min={0} step="0.5" value={f.estimateDays ?? ''} onChange={(e) => set('estimateDays', e.target.value === '' ? null : Number(e.target.value))} error={errors.estimateDays} />
              <SelectField id="tk-ms" label="Mốc" allowEmpty value={f.milestoneId ?? null} onChange={(v) => set('milestoneId', v)} options={milestones.map((m) => ({ value: m.id, label: m.title }))} />
            </div>
          </fieldset>
          <DialogFooter className="items-center">
            {task && canDelete && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => confirm(`Xoá việc ${task.code}?`) && remove.mutate(task.id, {
              onSuccess: () => { toast.success('Đã xoá'); onClose(); }, onError: (err) => toast.error(errorMessage(err)) })}><Trash2 /> Xoá</Button>}
            <Button type="button" variant="outline" onClick={onClose}>Đóng</Button>
            {canWork && <Button type="submit" disabled={save.isPending}>Lưu</Button>}
          </DialogFooter>
        </form>
        {task && (
          <div className="grid gap-2 border-t pt-3">
            <div className="text-sm font-medium">Bình luận ({comments.length})</div>
            {comments.map((c) => <div key={c.id} className="rounded-md bg-muted/50 p-2 text-sm"><div className="text-xs text-muted-foreground">{c.authorName} · {fmtTime(c.createdAt)}</div>
              <div className="whitespace-pre-wrap">{c.content}</div></div>)}
            {canWork && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(comment, { onSuccess: () => setComment(''), onError: (err) => toast.error(errorMessage(err)) }); }}>
              <Textarea rows={2} placeholder="Viết bình luận…" aria-label="Bình luận" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button type="submit" size="sm" disabled={addComment.isPending || !comment.trim()}>Gửi</Button>
            </form>}
            <p className="text-xs text-muted-foreground">Tạo bởi {task.createdByName} · {fmtTime(task.createdAt)}{task.completedAt && ` · xong ${fmtTime(task.completedAt)}`}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
