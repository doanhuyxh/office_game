import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Spinner } from '@/components/feedback/Spinner';
import { useAddComment, useComments } from '../../hooks/useNews';
import type { IComment } from '../../types/news.types';
import { CommentInput } from '../comment-input';
import { CommentItem } from '../comment-item';

/** Bình luận của một bài: bình luận gốc (cũ → mới) + trả lời một cấp. `focusId` cuộn tới bình luận từ thông báo. */
export function CommentsSection({ postId, disabled, focusId }: { postId: string; disabled: boolean; focusId?: string | null }) {
  const q = useComments(postId, true);
  const add = useAddComment(postId);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const roots = all.filter((c) => !c.parentId);
  const repliesOf = (id: string) => all.filter((c) => c.parentId === id);

  useEffect(() => {
    if (!focusId || !all.some((c) => c.id === focusId)) return;
    document.getElementById(`comment-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusId, all]);

  return (
    <div className="grid gap-3 border-t pt-3" data-testid="comments-section">
      {q.isLoading && <Spinner />}
      {q.isError && <p className="text-sm text-destructive">Không tải được bình luận. <button type="button" className="underline" onClick={() => q.refetch()}>Thử lại</button></p>}
      {roots.map((c: IComment) => (
        <div key={c.id} className="grid gap-2">
          <CommentItem postId={postId} comment={c} highlight={c.id === focusId} onReply={disabled ? null : () => setReplyTo(c.id)} />
          {(repliesOf(c.id).length > 0 || replyTo === c.id) && (
            <div className="ms-10 grid gap-2">
              {repliesOf(c.id).map((r) => (
                <CommentItem key={r.id} postId={postId} comment={r} highlight={r.id === focusId} onReply={disabled ? null : () => setReplyTo(c.id)} />
              ))}
              {replyTo === c.id && (
                <CommentInput autoFocus placeholder={`Trả lời ${c.author.name}…`} onCancel={() => setReplyTo(null)}
                  onSubmit={async (text, uploadId) => { await add.mutateAsync({ text, parentId: c.id, uploadId }); setReplyTo(null); }} />
              )}
            </div>
          )}
        </div>
      ))}
      {q.hasNextPage && (
        <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
          {q.isFetchingNextPage && <Loader2 className="animate-spin" />} Xem thêm bình luận
        </Button>
      )}
      {!q.isLoading && roots.length === 0 && <p className="text-sm text-muted-foreground">{disabled ? 'Bình luận đã tắt.' : 'Chưa có bình luận nào. Hãy là người đầu tiên!'}</p>}
      {disabled ? roots.length > 0 && <p className="text-xs text-muted-foreground">Bình luận đã tắt cho bài này.</p> : (
        <CommentInput placeholder="Viết bình luận…" onSubmit={(text, uploadId) => add.mutateAsync({ text, parentId: null, uploadId })} />
      )}
    </div>
  );
}
