import { BotBadge } from '@/components/common/bot-badge';
import { confirmDialog, promptDialog } from '@/components/common/confirm-dialog';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Markdown } from '@/components/common/markdown';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTaskDetail } from '../../hooks/useProjects';
import type { IMember, IMilestone, ITask, ITaskActivity, ITaskRequest, TaskState } from '../../types/project.types';
import { ACTIVITY_LABEL, needsMoveNote, TASK_STATE, TASK_STATES } from '../../utils/labels';
import { isHttpUrl } from '../../utils/media';
import { TaskMedia } from '../task-media';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const stateLabel = (s: string | null) => (s && s in TASK_STATE ? TASK_STATE[s as TaskState].label : s ?? '—');
const fmtDay = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : 'không có');

/** Một dòng lịch sử: "Nguyễn A [BOT] chuyển trạng thái Đang làm → Chờ review · 10/11 09:30" (+ lý do). */
function ActivityLine({ a }: { a: ITaskActivity }) {
  const change = a.kind === 'Moved' ? `${stateLabel(a.from)} → ${stateLabel(a.to)}`
    : a.kind === 'Created' ? `(${stateLabel(a.to)})`
    : a.kind === 'Assigned' ? `${a.from ?? 'chưa giao'} → ${a.to ?? 'chưa giao'}`
    : a.kind === 'DueChanged' ? `${fmtDay(a.from)} → ${fmtDay(a.to)}` : '';
  return (
    <li className="text-xs" data-testid="task-activity">
      <span className="font-medium">{a.actorName}</span>{a.byBot && <BotBadge className="ml-1" />} {ACTIVITY_LABEL[a.kind]} {change}
      <span className="text-muted-foreground"> · {fmtTime(a.at)}</span>
      {a.note && <div className="text-muted-foreground">Lý do: {a.note}</div>}
    </li>
  );
}

/**
 * Thêm / sửa việc + bình luận + lịch sử. `task`: undefined = đóng, null = thêm mới (trạng thái `initialState`).
 * `requireReview`: dự án cần duyệt → việc mới chỉ Cần làm / Đang làm; lưu với trạng thái lùi từ Chờ review / Xong → hỏi lý do.
 */
export function TaskDialog({ projectId, task, initialState = 'Todo', members, milestones, canWork, canDelete, requireReview = false, onClose }: {
  projectId: string; task: ITask | null | undefined; initialState?: TaskState; members: IMember[]; milestones: IMilestone[]; canWork: boolean; canDelete: boolean;
  requireReview?: boolean; onClose: () => void;
}) {
  const open = task !== undefined;
  const [f, setF] = useState<ITaskRequest>({ title: '', state: 'Todo' });
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState(false);
  const [links, setLinks] = useState<string[]>([]);
  const save = useProjectMutation((b: ITaskRequest): Promise<unknown> => (task ? projectApi.updateTask(task.id, b) : projectApi.createTask(projectId, b)));
  const remove = useProjectMutation(projectApi.deleteTask);
  const addComment = useProjectMutation((c: string) => projectApi.addComment(task!.id, c));
  const detail = useTaskDetail(task?.id ?? null).data;
  const comments = detail?.comments ?? [];
  const activities = detail?.activities ?? [];
  const [showHistory, setShowHistory] = useState(false);
  const createStates = requireReview ? TASK_STATES.filter((s) => s === 'Todo' || s === 'Doing') : TASK_STATES;
  useEffect(() => {
    if (!open) return;
    save.reset(); setComment(''); setShowHistory(false);
    setPreview(!!task?.description); // việc đã có mô tả → mở ở chế độ xem Markdown
    setLinks(task?.mediaLinks.length ? [...task.mediaLinks] : []);
    setF(task ? { title: task.title, description: task.description ?? '', state: task.state, assigneeEmployeeId: task.assigneeEmployeeId, milestoneId: task.milestoneId,
      dueOn: task.dueOn ?? '', estimateDays: task.estimateDays } : { title: '', description: '', state: createStates.includes(initialState) ? initialState : 'Todo', assigneeEmployeeId: null, milestoneId: null, dueOn: '', estimateDays: null });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, task?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ITaskRequest>(k: K, v: ITaskRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{task ? `${task.code} · ${task.title}` : 'Thêm việc'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          let note: string | null = null;
          if (task && needsMoveNote(task.state, f.state, requireReview)) {
            note = await promptDialog({ title: task.state === 'Done' ? `Mở lại ${task.code}?` : `Review chưa đạt: ${task.code}`, label: 'Lý do (thành bình luận của việc)',
              multiline: true, required: true, confirmText: 'Lưu' });
            if (note === null) return;
          }
          save.mutate({ ...f, note, dueOn: f.dueOn || null, description: f.description || null, mediaLinks: links.map((l) => l.trim()).filter(Boolean) }, {
            onSuccess: () => { toast.success('Đã lưu việc'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <fieldset disabled={!canWork} className="grid gap-3">
            <FormField id="tk-title" label="Tên việc *" required autoFocus maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="tk-desc">Nội dung <span className="font-normal text-muted-foreground">(Markdown)</span></Label>
                {canWork && <div className="flex rounded-md border p-0.5 text-xs">
                  {([['Viết', false], ['Xem trước', true]] as const).map(([label, v]) => (
                    <button key={label} type="button" onClick={() => setPreview(v)}
                      className={`rounded px-2 py-0.5 ${preview === v ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>))}
                </div>}
              </div>
              {preview || !canWork
                ? <div className="max-h-[50vh] min-h-20 overflow-y-auto rounded-md border px-3 py-2" onDoubleClick={() => canWork && setPreview(false)}>
                    {f.description?.trim() ? <Markdown text={f.description} /> : <p className="text-sm text-muted-foreground">Chưa có nội dung.</p>}
                  </div>
                : <Textarea id="tk-desc" rows={8} maxLength={20000} className="font-mono text-xs" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)}
                    placeholder={'## Mục tiêu\n- [ ] Việc cần làm\n**đậm**, *nghiêng*, `code`, [link](https://...), ![ảnh](https://.../a.png)'} />}
              {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Ảnh / video <span className="font-normal text-muted-foreground">(link)</span></Label>
                {canWork && links.length < 20 && <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setLinks((x) => [...x, ''])}><ImagePlus /> Thêm link</Button>}
              </div>
              {canWork && links.map((l, i) => (
                <div key={i} className="flex gap-1">
                  <Input aria-label={`Link ảnh / video ${i + 1}`} type="url" inputMode="url" maxLength={1000} placeholder="https://… (ảnh .png/.jpg, video .mp4, YouTube, Vimeo, Google Drive)"
                    value={l} onChange={(e) => setLinks((x) => x.map((v, j) => (j === i ? e.target.value : v)))}
                    aria-invalid={!!l.trim() && !isHttpUrl(l)} />
                  <Button type="button" size="icon" variant="ghost" aria-label="Bỏ link" onClick={() => setLinks((x) => x.filter((_, j) => j !== i))}><X /></Button>
                </div>
              ))}
              {errors.mediaLinks && <p className="text-xs text-destructive">{errors.mediaLinks}</p>}
              <TaskMedia links={links.map((l) => l.trim()).filter(isHttpUrl)} />
              {!canWork && !links.length && <p className="text-sm text-muted-foreground">Không có.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField id="tk-state" label="Trạng thái" value={f.state} onChange={(v) => set('state', (v ?? 'Todo') as TaskState)} error={errors.state}
                options={(task ? TASK_STATES : createStates).map((s) => ({ value: s, label: TASK_STATE[s].label }))} />
              <SelectField id="tk-who" label="Người làm" allowEmpty emptyLabel="— Chưa giao —" value={f.assigneeEmployeeId ?? null} onChange={(v) => set('assigneeEmployeeId', v)}
                options={members.filter((m) => m.isActive).map((m) => ({ value: m.employeeId, label: m.fullName }))} error={errors.assigneeEmployeeId} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {/* Không chọn ngày đã qua (back-end cũng chặn; giữ nguyên hạn cũ đã qua khi sửa vẫn được) */}
              <FormField id="tk-due" label="Hạn" type="date" min={todayVn()} value={f.dueOn ?? ''} onChange={(e) => set('dueOn', e.target.value)} error={errors.dueOn} />
              <FormField id="tk-est" label="Ước lượng (ngày)" type="number" min={0} step="0.5" value={f.estimateDays ?? ''} onChange={(e) => set('estimateDays', e.target.value === '' ? null : Number(e.target.value))} error={errors.estimateDays} />
              <SelectField id="tk-ms" label="Mốc" allowEmpty value={f.milestoneId ?? null} onChange={(v) => set('milestoneId', v)} options={milestones.map((m) => ({ value: m.id, label: m.title }))} />
            </div>
          </fieldset>
          <DialogFooter className="items-center">
            {task && canDelete && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={async () => await confirmDialog({ title: `Xoá việc ${task.code}?`, confirmText: 'Xoá', destructive: true }) && remove.mutate(task.id, {
              onSuccess: () => { toast.success('Đã xoá'); onClose(); }, onError: (err) => toast.error(errorMessage(err)) })}><Trash2 /> Xoá</Button>}
            <Button type="button" variant="outline" onClick={onClose}>Đóng</Button>
            {canWork && <Button type="submit" disabled={save.isPending}>Lưu</Button>}
          </DialogFooter>
        </form>
        {task && (
          <div className="grid gap-2 border-t pt-3">
            <div className="text-sm font-medium">Bình luận ({comments.length})</div>
            {comments.map((c) => <div key={c.id} className="rounded-md bg-muted/50 p-2 text-sm"><div className="text-xs text-muted-foreground">{c.authorName}{c.byBot && <BotBadge className="ml-1" />} · {fmtTime(c.createdAt)}</div>
              <Markdown text={c.content} /></div>)}
            {canWork && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) addComment.mutate(comment, { onSuccess: () => setComment(''), onError: (err) => toast.error(errorMessage(err)) }); }}>
              <Textarea rows={2} placeholder="Viết bình luận…" aria-label="Bình luận" value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button type="submit" size="sm" disabled={addComment.isPending || !comment.trim()}>Gửi</Button>
            </form>}
            <p className="text-xs text-muted-foreground">Tạo bởi {task.createdByName}{task.createdByBot && <BotBadge className="ml-1" />} · {fmtTime(task.createdAt)}{task.completedAt && ` · xong ${fmtTime(task.completedAt)}`}
              {activities.length > 0 && <button type="button" className="ml-2 underline" onClick={() => setShowHistory((x) => !x)}>{showHistory ? 'Ẩn lịch sử' : `Lịch sử (${activities.length})`}</button>}</p>
            {showHistory && <ul className="grid gap-1 rounded-md border p-2" data-testid="task-history">{[...activities].reverse().map((a) => <ActivityLine key={a.id} a={a} />)}</ul>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
