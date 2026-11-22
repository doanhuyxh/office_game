import { Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Skeleton } from '@/components/common/skeleton';
import { errorMessage } from '@/utils/errors';
import { useFacebookComments } from '../../hooks/useFacebook';
import { FacebookCommentItem } from '../facebook-comment-item';

/**
 * Khung bình luận của một bài Fanpage (TEST-212) — mở bằng nút số bình luận trên thẻ bài. Bình luận cấp 1 lấy thẳng từ Facebook (mới nhất trước,
 * "Xem thêm bình luận"); mỗi bình luận có "Xem N trả lời" + "Trả lời" dưới tên Trang. Token thiếu `pages_manage_engagement` / token lỗi → ẩn nút
 * trả lời, hiện lý do. Lỗi (Facebook / mạng) → thông báo + Thử lại.
 */
export function FacebookPostComments({ pageId, postId }: { pageId: string; postId: string }) {
  const q = useFacebookComments(pageId, postId, true);
  // Lượt tải gần nhất phản ánh quyền hiện tại (token có thể vừa hỏng)
  const latest = q.data?.pages.at(-1);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="grid gap-3 border-t pt-3" data-testid="post-comments" aria-label="Bình luận">
      {q.isPending ? (
        <div className="grid gap-3" data-testid="post-comments-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
            </div>
          ))}
        </div>
      ) : q.isError ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" data-testid="post-comments-error">
          <span>{errorMessage(q.error)}</span>
          <Button size="sm" variant="outline" onClick={() => void q.refetch()} loading={q.isRefetching}><RefreshCw /> Thử lại</Button>
        </div>
      ) : (
        <>
          {latest && !latest.canReply && latest.replyBlockedReason && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs" data-testid="post-comments-reply-blocked">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>Không trả lời được bình luận: {latest.replyBlockedReason}</span>
            </p>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="post-comments-empty">Bài chưa có bình luận nào.</p>
          ) : (
            <ul className="grid gap-3" data-testid="post-comments-list">
              {items.map((c) => (
                <FacebookCommentItem key={c.id} comment={c} pageId={pageId} postId={postId} canReply={latest?.canReply ?? false} />
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <Button size="sm" variant="ghost" className="w-fit" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}
              data-testid="post-comments-more">
              Xem thêm bình luận
            </Button>
          )}
        </>
      )}
    </section>
  );
}
