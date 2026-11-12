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
import type { IMember, IMilestone, ITask, ITaskActivity, ITaskColumn, ITaskRequest } from '../../types/project.types';
import { ACTIVITY_LABEL, createColumns, needsMoveNote, stateLabel } from '../../utils/labels';
import { isHttpUrl } from '../../utils/media';
import { TaskDependencies } from '../task-dependencies';
import { TaskMedia } from '../task-media';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const fmtDay = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : 'không có');

/** Một dòng lịch sử: "Nguyễn A [BOT] chuyển trạng thái Đang làm → Chờ review · 10/11 09:30" (+ lý do). */
function ActivityLine({ a }: { a: ITaskActivity }) {
  const change = a.kind === 'Moved' ? `${stateLabel(a.from) || '—'} → ${stateLabel(a.to) || '—'}`
    : a.kind === 'Created' ? `(${stateLabel(a.to)})`
    : a.kind === 'Assigned' ? `${a.from ?? 'chưa giao'} → ${a.to ?? 'chưa giao'}`
    : a.kind === 'DueChanged' ? `${fmtDay(a.from)} → ${fmtDay(a.to)}`
    : a.kind === 'Depends' ? `${a.from ?? 'không'} → ${a.to ?? 'không'}` : '';
  return (
    <li className="text-xs" data-testid="task-activity">
      <span className="font-medium">{a.actorName}</span>{a.byBot && <BotBadge className="ml-1" />} {ACTIVITY_LABEL[a.kind]} {change}
      <span className="text-muted-foreground"> · {fmtTime(a.at)}</span>
      {a.note && <div className="text-muted-foreground">Lý do: {a.note}</div>}
    </li>
  );
}

/**
 * Thêm / sửa việc + bình luận + lịch sử. `task`: undefined = đóng, null = thêm mới (cột `initialColumnId`).
 * `sequential`: dự án đi lần lượt → việc mới chỉ ở các cột trước cột cần duyệt / hoàn thành; lưu với trạng thái lùi → hỏi lý do.
 */
export function TaskDialog({ projectId, task, initialColumnId, columns, members, milestones, canWork, canDelete, sequential = false, onClose }: {
  projectId: string; task: ITask | null | undefined; initialColumnId?: string; columns: ITaskColumn[]; members: IMember[]; milestones: IMilestone[]; canWork: boolean;
  /** Quản lý dự án / HR: xoá việc, tạo việc ở cột cần người duyệt. */
  canDelete: boolean;
  sequential?: boolean; onClose: () => void;
}) {
  const open = task !== undefined;
  const [f, setF] = useState<ITaskRequest>({ title: '', columnId: null });
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
  const createCols = createColumns(columns, sequential, canDelete);
  useEffect(() => {
    if (!open) return;
    save.reset(); setComment(''); setShowHistory(false);
    setPreview(!!task?.description); // việc đã có mô tả → mở ở chế độ xem Markdown
    setLinks(task?.mediaLinks.length ? [...task.mediaLinks] : []);
    setF(task ? { title: task.title, description: task.description ?? '', columnId: task.columnId, assigneeEmployeeId: task.assigneeEmployeeId, milestoneId: task.milestoneId,
      dueOn: task.dueOn ?? '', estimateDays: task.estimateDays } : { title: '', description: '', columnId: createCols.find((c) => c.id === initialColumnId)?.id ?? createCols[0]?.id ?? null, assigneeEmployeeId: null, milestoneId: null, dueOn: '', estimateDays: null });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, task?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ITaskRequest>(k: K, v: ITaskRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const postComment = () => { if (comment.trim()) addComment.mutate(comment, { onSuccess: () => setComment(''), onError: (err) => toast.error(errorMessage(err)) }); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-0 p-0 sm:max-w-none">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={async (e) => {
          e.preventDefault();
          let note: string | null = null;
          if (task && f.columnId && needsMoveNote(columns, task.columnId, f.columnId, sequential)) {
            const to = columns.find((c) => c.id === f.columnId)?.name ?? '';
            note = await promptDialog({ title: `Trả ${task.code} về "${to}"?`, label: 'Lý do (thành bình luận của việc)',
              multiline: true, required: true, confirmText: 'Lưu' });
            if (note === null) return;
          }
          save.mutate({ ...f, note, dueOn: f.dueOn || null, description: f.description || null, mediaLinks: links.map((l) => l.trim()).filter(Boolean) }, {
            onSuccess: () => { toast.success('Đã lưu việc'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <DialogHeader className="shrink-0 border-b py-4 pr-12 pl-6 text-left">
            <DialogTitle className="leading-snug">{task ? `${task.code} · ${task.title}` : 'Thêm việc'}</DialogTitle>
          </DialogHeader>
          {/* Mobile: 1 cột, cả vùng cuộn chung; từ lg: 2 cột cuộn độc lập */}
          <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:content-stretch lg:overflow-hidden">
            <div className="flex flex-col gap-3 px-6 py-4 lg:min-h-0 lg:overflow-y-auto">
              <fieldset disabled={!canWork} className="grid min-w-0 grid-cols-1 gap-3">
                <FormField id="tk-title" label="Tên việc *" required autoFocus maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="tk-desc">Nội dung <span className="font-normal text-muted-foreground">(Markdown)</span></Label>
                    {canWork && <div className="flex rounded-md border p-0.5 text-xs">
                      {([['Viết', false], ['Xem trước', true]] as const).map(([label, v]) => (
                        <button key={label} type="button" onClick={() => setPreview(v)}
                          className={`rounded px-2 py-0.5 ${preview === v ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>))}
                    </div>}
                  </div>
                  {preview || !canWork
                    ? <div className="min-h-20 rounded-md border px-3 py-2 wrap-anywhere" onDoubleClick={() => canWork && setPreview(false)}>
                        {f.description?.trim() ? <Markdown text={f.description} /> : <p className="text-sm text-muted-foreground">Chưa có nội dung.</p>}
                      </div>
                    : <Textarea id="tk-desc" rows={10} maxLength={20000} className="font-mono text-xs" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)}
                        placeholder={'## Mục tiêu\n- [ ] Việc cần làm\n**đậm**, *nghiêng*, `code`, [link](https://...), ![ảnh](https://.../a.png)'} />}
                  {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
                </div>
                <div className="grid grid-cols-1 gap-2">
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
              </fieldset>
              {task && (
                <div className="grid gap-2 border-t pt-3">
                  <div className="text-sm font-medium">Bình luận ({comments.length})</div>
                  {comments.map((c) => <div key={c.id} className="rounded-md bg-muted/50 p-2 text-sm"><div className="text-xs text-muted-foreground">{c.authorName}{c.byBot && <BotBadge className="ml-1" />} · {fmtTime(c.createdAt)}</div>
                    <Markdown text={c.content} /></div>)}
                  {canWork && <div className="flex gap-2">
                    <Textarea rows={2} placeholder="Viết bình luận…" aria-label="Bình luận" value={comment} onChange={(e) => setComment(e.target.value)} />
                    <Button type="button" size="sm" disabled={addComment.isPending || !comment.trim()} onClick={postComment}>Gửi</Button>
                  </div>}
                  <p className="text-xs text-muted-foreground">Tạo bởi {task.createdByName}{task.createdByBot && <BotBadge className="ml-1" />} · {fmtTime(task.createdAt)}{task.completedAt && ` · xong ${fmtTime(task.completedAt)}`}
                    {activities.length > 0 && <button type="button" className="ml-2 underline" onClick={() => setShowHistory((x) => !x)}>{showHistory ? 'Ẩn lịch sử' : `Lịch sử (${activities.length})`}</button>}</p>
                  {showHistory && <ul className="grid gap-1 rounded-md border p-2" data-testid="task-history">{[...activities].reverse().map((a) => <ActivityLine key={a.id} a={a} />)}</ul>}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 border-t px-6 py-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <fieldset disabled={!canWork} className="grid min-w-0 grid-cols-1 gap-3">
                <SelectField id="tk-state" label="Trạng thái" value={f.columnId ?? null} onChange={(v) => set('columnId', v)} error={errors.columnId}
                  options={(task ? columns : createCols).map((c) => ({ value: c.id, label: c.name }))} />
                <SelectField id="tk-who" label="Người làm" allowEmpty emptyLabel="— Chưa giao —" value={f.assigneeEmployeeId ?? null} onChange={(v) => set('assigneeEmployeeId', v)}
                  options={members.filter((m) => m.isActive).map((m) => ({ value: m.employeeId, label: m.fullName }))} error={errors.assigneeEmployeeId} />
                {/* Không chọn ngày đã qua (back-end cũng chặn; giữ nguyên hạn cũ đã qua khi sửa vẫn được) */}
                <FormField id="tk-due" label="Hạn" type="date" min={todayVn()} value={f.dueOn ?? ''} onChange={(e) => set('dueOn', e.target.value)} error={errors.dueOn} />
                <FormField id="tk-est" label="Ước lượng (ngày)" type="number" min={0} step="0.5" value={f.estimateDays ?? ''} onChange={(e) => set('estimateDays', e.target.value === '' ? null : Number(e.target.value))} error={errors.estimateDays} />
                <SelectField id="tk-ms" label="Mốc" allowEmpty value={f.milestoneId ?? null} onChange={(v) => set('milestoneId', v)} options={milestones.map((m) => ({ value: m.id, label: m.title }))} />
              </fieldset>
              {task && detail && (
                <div className="border-t pt-3">
                  <TaskDependencies projectId={projectId} taskId={task.id} dependsOn={detail.dependsOn ?? []} blocks={detail.blocks ?? []} canWork={canWork} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 items-center border-t px-6 py-4">
            {task && canDelete && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={async () => await confirmDialog({ title: `Xoá việc ${task.code}?`, confirmText: 'Xoá', destructive: true }) && remove.mutate(task.id, {
              onSuccess: () => { toast.success('Đã xoá'); onClose(); }, onError: (err) => toast.error(errorMessage(err)) })}><Trash2 /> Xoá</Button>}
            <Button type="button" variant="outline" onClick={onClose}>Đóng</Button>
            {canWork && <Button type="submit" disabled={save.isPending}>Lưu</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
