import { useState } from 'react';
import { CornerDownRight, ThumbsUp } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/common/avatar';
import { Button } from '@/components/common/button';
import { ImageViewer } from '@/components/common/image-viewer';
import { nameInitials } from '@/components/common/PersonAvatar';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useFacebookReplies } from '../../hooks/useFacebook';
import type { IFacebookComment } from '../../types/facebook.types';
import { FacebookCommentReplyBox } from '../facebook-comment-reply-box';

/** Facebook không trả người bình luận (quyền riêng tư / trạng thái app). */
const UNKNOWN = 'Người dùng Facebook';

/**
 * Một bình luận / trả lời của bài Fanpage (TEST-212): ảnh đại diện (lỗi / thiếu → chữ viết tắt), tên ("Người dùng Facebook" khi Facebook không trả),
 * nhãn "Trang", nội dung, ảnh đính kèm (bấm xem lớn), giờ VN, số thích, nhãn "Trả lời bởi … lúc …" cho trả lời gửi từ OfficeHub.
 * Bình luận cấp 1 (`nested` false): nút "Trả lời" (khi `canReply`), "Xem N trả lời" tải trả lời từ Facebook (cũ nhất trước, "Xem thêm trả lời").
 */
export function FacebookCommentItem({ comment, pageId, postId, canReply, nested = false }: {
  comment: IFacebookComment; pageId: string; postId: string; canReply: boolean; nested?: boolean;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const [replying, setReplying] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const replies = useFacebookReplies(pageId, postId, comment.id, !nested && showReplies);
  const name = comment.fromName ?? UNKNOWN;
  const list = replies.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <li className="flex gap-2" data-testid={nested ? 'comment-reply' : 'comment'} data-comment-id={comment.id}>
      <Avatar className={nested ? 'size-7' : 'size-8'}>
        {comment.fromPictureUrl && <AvatarImage src={comment.fromPictureUrl} alt="" referrerPolicy="no-referrer" className="object-cover" />}
        <AvatarFallback className="text-[11px]">{comment.fromName ? nameInitials(comment.fromName) : '?'}</AvatarFallback>
      </Avatar>
      <div className="grid min-w-0 flex-1 content-start gap-1">
        <div className="w-fit max-w-full rounded-2xl bg-muted px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs font-semibold">
            <span className={comment.fromName ? '' : 'text-muted-foreground italic'} data-testid="comment-author">{name}</span>
            {comment.fromPage && <StatusBadge tone="info" className="text-[10px]">Trang</StatusBadge>}
          </div>
          {comment.message
            ? <p className="text-sm break-words whitespace-pre-line" data-testid="comment-message">{comment.message}</p>
            : !comment.attachmentImageUrl && <p className="text-sm text-muted-foreground italic">(Không có nội dung chữ)</p>}
        </div>
        {comment.attachmentImageUrl && (
          <>
            <button type="button" className="w-fit overflow-hidden rounded-lg border" onClick={() => setViewer(0)} aria-label="Xem ảnh trong bình luận">
              <img src={comment.attachmentImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-40 max-w-60 object-cover" />
            </button>
            <ImageViewer images={[{ id: comment.id, url: comment.attachmentImageUrl, fileName: 'anh-binh-luan.jpg', caption: name, downloadable: false }]}
              index={viewer} onIndex={setViewer} />
          </>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 text-xs text-muted-foreground">
          <span>{formatDateTime(comment.createdTime)}</span>
          {comment.likeCount > 0 && <span className="inline-flex items-center gap-1"><ThumbsUp className="size-3" /> {comment.likeCount.toLocaleString('vi-VN')}</span>}
          {!nested && canReply && (
            <button type="button" className="font-semibold hover:underline" data-testid="comment-reply-toggle"
              onClick={() => { setReplying((v) => !v); setShowReplies(true); }}>
              Trả lời
            </button>
          )}
        </div>
        {comment.repliedByName && (
          <p className="px-1 text-xs text-muted-foreground" data-testid="comment-replied-by">
            Trả lời bởi <span className="font-medium text-foreground">{comment.repliedByName}</span>
            {comment.repliedAt && <> lúc {formatDateTime(comment.repliedAt)}</>}
          </p>
        )}
        {!nested && comment.replyCount > 0 && !showReplies && (
          <button type="button" className="inline-flex w-fit items-center gap-1 px-1 text-xs font-semibold text-primary hover:underline"
            data-testid="comment-show-replies" onClick={() => setShowReplies(true)}>
            <CornerDownRight className="size-3.5" /> Xem {comment.replyCount.toLocaleString('vi-VN')} trả lời
          </button>
        )}
        {!nested && showReplies && (
          <div className="grid gap-2 pt-1">
            {replies.isPending && comment.replyCount > 0 && <p className="text-xs text-muted-foreground">Đang tải trả lời…</p>}
            {replies.isError && (
              <p className="text-xs text-destructive">
                {errorMessage(replies.error)}{' '}
                <button type="button" className="font-semibold underline" onClick={() => void replies.refetch()}>Thử lại</button>
              </p>
            )}
            {list.length > 0 && (
              <ul className="grid gap-2" data-testid="comment-replies">
                {list.map((r) => <FacebookCommentItem key={r.id} comment={r} pageId={pageId} postId={postId} canReply={false} nested />)}
              </ul>
            )}
            {replies.hasNextPage && (
              <Button size="sm" variant="ghost" className="h-7 w-fit px-2 text-xs" loading={replies.isFetchingNextPage}
                onClick={() => void replies.fetchNextPage()}>
                Xem thêm trả lời
              </Button>
            )}
            {replying && canReply && (
              <FacebookCommentReplyBox pageId={pageId} postId={postId} commentId={comment.id} replyTo={name} onSent={() => setReplying(false)} />
            )}
          </div>
        )}
      </div>
    </li>
  );
}
