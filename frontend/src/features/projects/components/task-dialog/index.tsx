import { BotBadge } from '@/components/common/bot-badge';
import { confirmDialog, promptDialog } from '@/components/common/confirm-dialog';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ImagePlus, RotateCw, Trash2, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Skeleton } from '@/components/common/skeleton';
import { SelectField } from '@/components/common/SelectField';
import { todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTaskDetail } from '../../hooks/useProjects';
import type { IMember, IMilestone, ITask, ITaskActivity, ITaskColumn, ITaskRequest } from '../../types/project.types';
import { ACTIVITY_LABEL, createColumns, needsMoveNote, stateLabel } from '../../utils/labels';
import { isHttpUrl } from '../../utils/media';
import { MAX_COMMENT_FILES, fileProblem, putToS3 } from '../../utils/attachments';
import { MarkdownEditor } from '../markdown-editor';
import { TaskCommentInput } from '../task-comment-input';
import { TaskCommentList } from '../task-comment-list';
import { TaskDependencies } from '../task-dependencies';
import { TaskFollowers } from '../task-followers';
import { TaskMedia } from '../task-media';
import { UploadLinkDialog } from '../upload-link-dialog';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const fmtDay = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : 'không có');

/** Một dòng lịch sử: "Nguyễn A [BOT] chuyển trạng thái Đang làm → Chờ review · 10/11 09:30" (+ lý do). */
function ActivityLine({ a }: { a: ITaskActivity }) {
  const change = a.kind === 'Moved' ? `${stateLabel(a.from) || '—'} → ${stateLabel(a.to) || '—'}`
    : a.kind === 'Created' ? `(${stateLabel(a.to)})`
    : a.kind === 'Assigned' ? `${a.from ?? 'chưa giao'} → ${a.to ?? 'chưa giao'}`
    : a.kind === 'Reviewer' ? `${a.from ?? 'không có'} → ${a.to ?? 'không có'}`
    : a.kind === 'DueChanged' ? `${fmtDay(a.from)} → ${fmtDay(a.to)}`
    : a.kind === 'Depends' ? `${a.from ?? 'không'} → ${a.to ?? 'không'}`
    : a.kind === 'Follow' ? (a.to ?? '') : a.kind === 'Unfollow' ? (a.from ?? '')
    : a.kind === 'StreakBlocked' ? `(${a.to ?? ''})` : '';
  return (
    <li className="text-xs" data-testid="task-activity">
      <span className="font-medium">{a.actorName}</span>{a.byBot && <BotBadge className="ml-1" />} {ACTIVITY_LABEL[a.kind]} {change}
      <span className="text-muted-foreground"> · {fmtTime(a.at)}</span>
      {a.note && <div className="text-muted-foreground">Lý do: {a.note}</div>}
    </li>
  );
}

const bar = 'bg-foreground/10';

/** Khung xương ô "Nội dung": cao ≈ ô Markdown 10 dòng (min-h-60) để hộp thoại không co rồi giãn khi mô tả về (TEST-242). */
function DescriptionSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2" aria-hidden data-testid="task-desc-skeleton">
      <div className="flex items-center justify-between gap-2">
        <Label>Nội dung <span className="font-normal text-muted-foreground">(Markdown)</span></Label>
        <Skeleton className={`h-6 w-28 ${bar}`} />
      </div>
      <div className="grid min-h-60 content-start gap-2.5 rounded-md border px-3 py-3">
        <Skeleton className={`h-4 w-1/3 ${bar}`} />
        {['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-2/3'].map((w, i) => <Skeleton key={i} className={`h-3 ${w} ${bar}`} />)}
      </div>
    </div>
  );
}

/** Khung xương một khối bên phải (người theo dõi / việc phải chờ): tiêu đề + `rows` dòng (hoặc chip) + ô chọn nếu sửa được. */
function SideSkeleton({ testId, rows, chips, input }: { testId: string; rows: number; chips?: boolean; input: boolean }) {
  return (
    <div className="grid gap-2 border-t pt-3" aria-hidden data-testid={testId}>
      <Skeleton className={`h-4 w-36 ${bar}`} />
      {chips ? <div className="flex flex-wrap gap-1.5">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={`h-6 w-28 rounded-full ${bar}`} />)}</div>
        : Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={`h-4 w-full ${bar}`} />)}
      {input && <><Skeleton className={`h-3.5 w-32 ${bar}`} /><Skeleton className={`h-9 w-full ${bar}`} /></>}
    </div>
  );
}

/**
 * Thêm / sửa việc + bình luận + lịch sử. `task`: undefined = đóng, null = thêm mới (cột `initialColumnId`).
 * `sequential`: dự án đi lần lượt → việc mới chỉ ở các cột trước cột cần duyệt / hoàn thành; lưu với trạng thái lùi → hỏi lý do.
 * `focusCommentId` (link chuông bình luận / @nhắc): cuộn tới bình luận đó và tô sáng.
 * TEST-242: việc có sẵn mà chi tiết (`useTaskDetail`) chưa về → phần có từ danh sách (tên, trạng thái, người làm, hạn…) hiện ngay, phần cần chi tiết
 * (mô tả, media, người theo dõi, việc phải chờ, lịch sử) là khung xương cùng cỡ; chi tiết về → form được điền ngay trong lần render đó (đặt state khi render,
 * không qua effect) nên không có khung hình mô tả rỗng / đổi chế độ xem–sửa. Đã có cache (mở lại, rê chuột tải trước) → hiện ngay. Lỗi → Thử lại.
 */
export function TaskDialog({ projectId, task, initialColumnId, columns, members, milestones, canWork, canComment, uploadLinks = true, canDelete, sequential = false, focusCommentId,
  onClose }: {
  projectId: string; task: ITask | null | undefined; initialColumnId?: string; columns: ITaskColumn[]; members: IMember[]; milestones: IMilestone[]; canWork: boolean;
  /** Bình luận (kèm tệp) — dự án đã đóng thành viên thường vẫn bình luận được dù canWork = false (TEST-213). */
  canComment: boolean;
  /** Link tải lên từ thiết bị khác — chỉ dự án đang chạy. */
  uploadLinks?: boolean;
  /** Quản lý dự án / HR: xoá việc, tạo việc ở cột cần người duyệt. */
  canDelete: boolean;
  sequential?: boolean; focusCommentId?: string; onClose: () => void;
}) {
  const open = task !== undefined;
  const [f, setF] = useState<ITaskRequest>({ title: '', columnId: null });
  const [comment, setComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState(false);
  const [uploadLinkOpen, setUploadLinkOpen] = useState(false);
  const [links, setLinks] = useState<string[]>([]);
  const save = useProjectMutation((b: ITaskRequest): Promise<unknown> => (task ? projectApi.updateTask(task.id, b) : projectApi.createTask(projectId, b)));
  const remove = useProjectMutation(projectApi.deleteTask);
  // Gửi bình luận = tải từng tệp đính kèm (xin vé → PUT lên S3) rồi đăng; isPending bao cả hai bước (nút gửi xoay suốt).
  const addComment = useProjectMutation(async ({ content, files }: { content: string; files: File[] }) => {
    const ids: string[] = [];
    for (const file of files) {
      const ticket = await projectApi.createUpload(task!.id, file);
      await putToS3(ticket, file);
      ids.push(ticket.id);
    }
    return projectApi.addComment(task!.id, content, ids);
  });
  const detailQuery = useTaskDetail(task?.id ?? null);
  const detail = task && detailQuery.data?.task.id === task.id ? detailQuery.data : undefined;
  const activities = detail?.activities ?? [];
  // TEST-240: danh sách việc là bản gọn (không mô tả / media) → mô tả + link lấy từ chi tiết; chưa tải xong thì khoá sửa + nút Lưu (tránh ghi đè mô tả thành rỗng).
  const full = detail?.task ?? null;
  const loaded = !task || !!full;
  const detailFailed = !!task && !full && detailQuery.isError;
  const [showHistory, setShowHistory] = useState(false);
  // @mã thành viên trong bình luận → hiện họ tên nổi bật (mã HOA → họ tên)
  const mentionNames = useMemo(() => new Map(members.filter((m) => m.code).map((m) => [m.code!.toUpperCase(), m.fullName])), [members]);
  const createCols = createColumns(columns, sequential, canDelete);
  // TEST-242: khởi tạo form khi mở + điền mô tả / link khi chi tiết về đều đặt state NGAY KHI RENDER (mẫu "điều chỉnh state khi prop đổi" của React):
  // React render lại trước khi vẽ nên màn hình không bao giờ thấy form của việc trước / mô tả rỗng rồi mới điền như khi dùng useEffect.
  const openKey = open ? (task?.id ?? 'new') : null;
  const [initKey, setInitKey] = useState<string | null>(null);
  const [filledFor, setFilledFor] = useState<string | null>(null);
  if (openKey !== initKey) {
    setInitKey(openKey); setFilledFor(null);
    if (open) {
      setComment(''); setCommentFiles([]); setShowHistory(false); setUploadLinkOpen(false);
      setPreview(!!task); setLinks([]); // việc có sẵn mở ở chế độ xem; mô tả / link điền khi chi tiết tải xong (dưới)
      setF(task ? { title: task.title, description: '', columnId: task.columnId, assigneeEmployeeId: task.assigneeEmployeeId, milestoneId: task.milestoneId,
        dueOn: task.dueOn ?? '', estimateDays: task.estimateDays } : { title: '', description: '', columnId: createCols.find((c) => c.id === initialColumnId)?.id ?? createCols[0]?.id ?? null, assigneeEmployeeId: null, milestoneId: null, dueOn: '', estimateDays: null });
    }
  }
  // Chi tiết tải xong (một lần mỗi lần mở) → điền mô tả + link; refetch sau đó (bình luận mới…) không ghi đè thứ người dùng đang sửa (vd tên việc gõ lúc chờ).
  if (open && full && filledFor !== full.id) {
    setFilledFor(full.id);
    setPreview(!!full.description); // việc đã có mô tả → mở ở chế độ xem Markdown
    setLinks(full.mediaLinks.length ? [...full.mediaLinks] : []);
    setF((x) => ({ ...x, description: full.description ?? '' }));
  }
  useEffect(() => {
    if (openKey) save.reset();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [openKey]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ITaskRequest>(k: K, v: ITaskRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const postComment = () => {
    if ((!comment.trim() && !commentFiles.length) || addComment.isPending) return;
    addComment.mutate({ content: comment.trim() ? comment : '', files: commentFiles }, {
      onSuccess: () => { setComment(''); setCommentFiles([]); },
      onError: (err) => toast.error(errorMessage(err, 'Không gửi được bình luận')),
    });
  };
  const addCommentFiles = (list: File[]) => {
    const accepted = list.filter((file) => {
      const problem = fileProblem(file);
      if (problem) toast.error(problem);
      return !problem;
    });
    const room = MAX_COMMENT_FILES - commentFiles.length;
    if (accepted.length > room) toast.error(`Mỗi bình luận đính kèm tối đa ${MAX_COMMENT_FILES} tệp`);
    if (room > 0 && accepted.length) setCommentFiles([...commentFiles, ...accepted.slice(0, room)]);
  };
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
                {!loaded ? (detailFailed ? (
                  <div className="grid grid-cols-1 gap-2">
                    <Label>Nội dung <span className="font-normal text-muted-foreground">(Markdown)</span></Label>
                    <div role="alert" className="flex min-h-60 flex-wrap content-center items-center justify-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="task-detail-error">
                      <AlertCircle className="size-4 shrink-0 text-destructive" />
                      <span>Không tải được chi tiết việc</span>
                      <Button type="button" size="sm" variant="outline" loading={detailQuery.isFetching} loadingText="Đang thử…" onClick={() => void detailQuery.refetch()}><RotateCw /> Thử lại</Button>
                    </div>
                  </div>
                ) : <DescriptionSkeleton />) : <MarkdownEditor id="tk-desc" label={<>Nội dung <span className="font-normal text-muted-foreground">(Markdown)</span></>}
                  value={f.description ?? ''} onChange={(v) => set('description', v)} preview={preview} onPreviewChange={setPreview} editable={canWork && loaded}
                  rows={10} maxLength={20000} error={errors.description}
                  placeholder={'## Mục tiêu\n- [ ] Việc cần làm\n**đậm**, *nghiêng*, `code`, [link](https://...), ![ảnh](https://.../a.png)'} />}
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Ảnh / video <span className="font-normal text-muted-foreground">(link)</span></Label>
                    {canWork && loaded && links.length < 20 && <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setLinks((x) => [...x, ''])}><ImagePlus /> Thêm link</Button>}
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
                  {task && !loaded && !detailFailed && task.mediaCount > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2" aria-hidden data-testid="task-media-skeleton">
                      {Array.from({ length: Math.min(task.mediaCount, 4) }, (_, i) => <Skeleton key={i} className={`h-40 w-full ${bar}`} />)}
                    </div>
                  )}
                  <TaskMedia links={links.map((l) => l.trim()).filter(isHttpUrl)} />
                  {!canWork && loaded && !links.length && <p className="text-sm text-muted-foreground">Không có.</p>}
                </div>
              </fieldset>
              {task && (
                <div className="grid gap-2 border-t pt-3">
                  <TaskCommentList taskId={task.id} commentCount={task.commentCount} mentions={mentionNames} focusCommentId={focusCommentId} />
                  {canComment && <TaskCommentInput members={members} value={comment} onChange={setComment} onSubmit={postComment} pending={addComment.isPending}
                    files={commentFiles} onAddFiles={addCommentFiles} onRemoveFile={(i) => setCommentFiles((x) => x.filter((_, j) => j !== i))}
                    onUploadLink={uploadLinks ? () => setUploadLinkOpen(true) : undefined} />}
                  {canComment && uploadLinks && <UploadLinkDialog taskId={task.id} taskCode={task.code} open={uploadLinkOpen} onClose={() => setUploadLinkOpen(false)} />}
                  <p className="text-xs text-muted-foreground">Tạo bởi {task.createdByName}{task.createdByBot && <BotBadge className="ml-1" />} · {fmtTime(task.createdAt)}{task.completedAt && ` · xong ${fmtTime(task.completedAt)}`}
                    {!detail && !detailFailed && <Skeleton aria-hidden className={`ml-2 inline-block h-3 w-20 align-middle ${bar}`} data-testid="task-history-skeleton" />}
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
              {/* TEST-172: Người theo dõi ngay sau Mốc, trước Phải chờ việc */}
              {task && !detail && !detailFailed && (canWork || (task.followerCount ?? 0) > 0) && <SideSkeleton testId="task-followers-skeleton" rows={Math.max(1, Math.min(task.followerCount ?? 0, 3))} chips input={canWork} />}
              {task && !detail && !detailFailed && (canWork || (task.waitingOn ?? 0) > 0) && <SideSkeleton testId="task-dependencies-skeleton" rows={Math.max(1, Math.min(task.waitingOn ?? 0, 3))} input={canWork} />}
              {task && detail && <TaskFollowers taskId={task.id} followers={detail.followers ?? []} members={members} canWork={canWork} />}
              {task && detail && (
                <div className="border-t pt-3">
                  <TaskDependencies projectId={projectId} taskId={task.id} dependsOn={detail.dependsOn ?? []} blocks={detail.blocks ?? []} canWork={canWork} columns={columns} />
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="shrink-0 items-center border-t px-6 py-4">
            {task && canDelete && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={async () => {
              if (!(await confirmDialog({ title: `Xoá việc ${task.code}?`, confirmText: 'Xoá', destructive: true, onConfirm: () => remove.mutateAsync(task.id) }))) return;
              toast.success('Đã xoá'); onClose();
            }}><Trash2 /> Xoá</Button>}
            <Button type="button" variant="outline" onClick={onClose}>Đóng</Button>
            {canWork && <Button type="submit" disabled={!loaded} loading={save.isPending} loadingText="Đang lưu…">Lưu</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
