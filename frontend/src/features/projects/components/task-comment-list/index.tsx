import { useEffect } from 'react';
import { toast } from 'sonner';
import { AlertCircle, Loader2, MessageSquare, RotateCw, Smartphone, Trash2 } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Markdown } from '@/components/common/markdown';
import { Skeleton } from '@/components/common/skeleton';
import { cn } from '@/utils/cn';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useTaskComments } from '../../hooks/useProjects';
import { CommentAttachments } from '../comment-attachments';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Khung xương một thẻ bình luận: thanh ngắn (tên · giờ) + hai thanh nội dung; viền + `bg-foreground/10` để đủ đậm cả nền sáng / tối. */
function CommentSkeleton() {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/50 p-2" aria-hidden data-testid="task-comment-skeleton">
      <Skeleton className="h-3 w-32 bg-foreground/10" />
      <Skeleton className="h-3 w-full bg-foreground/10" />
      <Skeleton className="h-3 w-2/3 bg-foreground/10" />
    </div>
  );
}

/**
 * Bình luận của việc (TEST-194): tải riêng qua `GET /tasks/{tid}/comments` (không chờ API chi tiết việc).
 * Đang tải lần đầu → "Bình luận (commentCount)" + vòng xoay + khung xương (≤ 3 thẻ; commentCount = 0 → hiện trạng thái trống luôn);
 * trống → khung viền đứt; lỗi → "Không tải được bình luận" + Thử lại; tải lại nền (sau gửi / xoá, cập nhật trực tiếp) → giữ danh sách cũ.
 * `focusCommentId` (link chuông bình luận / @nhắc): cuộn tới bình luận đó và tô sáng khi đã tải.
 */
export function TaskCommentList({ taskId, commentCount, mentions, focusCommentId }: {
  taskId: string; commentCount: number; mentions: Map<string, string>; focusCommentId?: string;
}) {
  const q = useTaskComments(taskId);
  const deleteComment = useProjectMutation(projectApi.deleteComment);
  const comments = q.data;
  const focusLoaded = !!focusCommentId && !!comments?.some((c) => c.id === focusCommentId);
  useEffect(() => {
    if (focusLoaded) document.getElementById(`task-comment-${focusCommentId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusLoaded, focusCommentId]);

  const loading = !comments && q.isPending && commentCount > 0;
  const failed = !comments && q.isError;
  const empty = !failed && !loading && !comments?.length;
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span>Bình luận ({comments?.length ?? commentCount})</span>
        {loading && <span role="status" className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground" data-testid="task-comments-loading">
          <Loader2 className="size-3.5 animate-spin" /> Đang tải…</span>}
      </div>
      {loading && Array.from({ length: Math.min(commentCount, 3) }, (_, i) => <CommentSkeleton key={i} />)}
      {failed && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="task-comments-error">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span className="flex-1">Không tải được bình luận</span>
          <Button type="button" size="sm" variant="outline" loading={q.isFetching} loadingText="Đang thử…" onClick={() => void q.refetch()}><RotateCw /> Thử lại</Button>
        </div>
      )}
      {empty && (
        <div className="flex items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="task-comments-empty">
          <MessageSquare className="size-4" /> Chưa có bình luận nào
        </div>
      )}
      {comments?.map((c) => <div key={c.id} id={`task-comment-${c.id}`} className={cn('rounded-md bg-muted/50 p-2 text-sm', c.id === focusCommentId && 'ring-2 ring-primary/50')} data-testid="task-comment">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">{c.authorName}{c.byBot && <BotBadge className="ml-1" />}
            {c.viaUploadLink && <span title="Gửi từ thiết bị khác qua link tải lên" data-testid="upload-link-badge"
              className="ml-1 inline-flex items-center gap-0.5 rounded bg-success/15 px-1 py-px align-middle text-[10px] font-semibold leading-none text-success"><Smartphone className="size-3" /> Qua link tải lên</span>} · {fmtTime(c.createdAt)}</span>
          {c.canDelete && <Button type="button" size="icon" variant="ghost" className="size-6 shrink-0 text-muted-foreground hover:text-destructive" aria-label="Xoá bình luận"
            loading={deleteComment.isPending && deleteComment.variables === c.id} disabled={deleteComment.isPending}
            onClick={async () => await confirmDialog({ title: 'Xoá bình luận?', description: 'Bình luận bị xoá hẳn; lịch sử việc ghi lại là đã xoá một bình luận.', confirmText: 'Xoá', destructive: true, onConfirm: () => deleteComment.mutateAsync(c.id) })
              && toast.success('Đã xoá bình luận')}>
            <Trash2 className="size-3.5" /></Button>}
        </div>
        {c.content && <Markdown text={c.content} mentions={mentions} />}
        {!!c.attachments?.length && <CommentAttachments attachments={c.attachments} caption={`${c.authorName} · ${fmtTime(c.createdAt)}`} />}</div>)}
    </>
  );
}
