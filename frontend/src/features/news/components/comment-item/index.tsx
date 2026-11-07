import { Fragment, useState } from 'react';
import { EyeOff, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { timeAgo } from '@/features/notifications';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { useEditComment, useModerateComment, useReactComment, useRemoveComment } from '../../hooks/useNews';
import type { IComment } from '../../types/news.types';
import { MENTION_TOKEN, reactionOf } from '../../utils/labels';
import { AuthorAvatar } from '../author-avatar';
import { CommentInput } from '../comment-input';
import { ReactionButton, ReactionSummaryLine } from '../reaction-bar';
import { ReasonDialog } from '../reason-dialog';

/** Chữ bình luận: `@[Tên](id)` → tên được tô màu. */
export function CommentText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_TOKEN)) {
    parts.push(text.slice(last, m.index));
    parts.push(<span key={m.index} className="font-semibold text-primary">@{m[1]}</span>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <p className="text-sm break-words whitespace-pre-wrap">{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</p>;
}

/** Một bình luận: bong bóng chữ / ảnh, cảm xúc, trả lời, sửa / xoá / ẩn. `onReply` = null → không cho trả lời (bài tắt bình luận). */
export function CommentItem({ postId, comment, onReply, highlight }: { postId: string; comment: IComment; onReply: (() => void) | null; highlight?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [hiding, setHiding] = useState(false);
  const edit = useEditComment(postId);
  const remove = useRemoveComment(postId);
  const react = useReactComment(postId);
  const mod = useModerateComment(postId);
  const gone = comment.deleted || (comment.text === null && !comment.imageUrl);
  const canAct = comment.canEdit || comment.canDelete || comment.canHide;

  return (
    <div className="flex gap-2" id={`comment-${comment.id}`} data-testid="comment">
      <AuthorAvatar author={comment.author} className="size-8" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <CommentInput initial={comment.text ?? ''} allowImage={false} autoFocus submitLabel="Lưu" onCancel={() => setEditing(false)}
            onSubmit={async (text) => { await edit.mutateAsync({ id: comment.id, text: text ?? '' }); setEditing(false); }} />
        ) : (
          <div className="group/comment flex items-start gap-1">
            <div className={cn('min-w-0 rounded-2xl bg-muted/60 px-3 py-1.5', highlight && 'ring-2 ring-primary/50')}>
              <p className="text-[13px] font-semibold">{comment.author.name}</p>
              {gone ? (
                <p className="text-sm text-muted-foreground italic">{comment.deleted ? 'Bình luận đã bị xoá' : 'Bình luận đã bị ẩn bởi quản trị'}</p>
              ) : (
                <>
                  {comment.hidden && <p className="mb-1 text-xs text-warning">Đã bị ẩn{comment.hiddenReason ? `: ${comment.hiddenReason}` : ''} (chỉ bạn và quản trị thấy)</p>}
                  {comment.text && <CommentText text={comment.text} />}
                  {comment.imageUrl && <img src={comment.imageUrl} alt="Ảnh đính kèm" loading="lazy" className="mt-1.5 max-h-60 rounded-lg" />}
                </>
              )}
            </div>
            {canAct && !gone && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" className="mt-1 opacity-0 group-hover/comment:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label="Tuỳ chọn bình luận"><MoreHorizontal /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {comment.canEdit && <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Sửa</DropdownMenuItem>}
                  {comment.canDelete && (
                    <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(comment.id, { onError: (e) => toast.error(errorMessage(e)) })}><Trash2 /> Xoá</DropdownMenuItem>
                  )}
                  {comment.canHide && !comment.canEdit && (comment.hidden
                    ? <DropdownMenuItem onSelect={() => mod.unhide.mutate(comment.id)}><EyeOff /> Hiện lại</DropdownMenuItem>
                    : <DropdownMenuItem onSelect={() => setHiding(true)}><EyeOff /> Ẩn (quản trị)</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        {!editing && !gone && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 px-1 text-xs text-muted-foreground">
            <ReactionButton compact mine={comment.myReaction} disabled={react.isPending} onReact={(type) => react.mutate({ id: comment.id, type }, { onError: (e) => toast.error(errorMessage(e)) })} />
            {onReply && <button type="button" className="font-medium hover:underline" onClick={onReply}>Trả lời</button>}
            <span title={new Date(comment.createdAt).toLocaleString('vi-VN')}>{timeAgo(comment.createdAt)}{comment.editedAt ? ' · đã sửa' : ''}</span>
            {comment.reactionCount > 0 && (
              <span className="inline-flex items-center gap-1">
                {comment.myReaction && <span>{reactionOf(comment.myReaction).emoji}</span>}
                <ReactionSummaryLine kind="comments" id={comment.id} total={comment.reactionCount} />
              </span>
            )}
          </div>
        )}
      </div>
      <ReasonDialog open={hiding} title="Ẩn bình luận" description="Tác giả sẽ nhận được lý do này. Bình luận vẫn hiện với tác giả và quản trị." confirmLabel="Ẩn bình luận"
        busy={mod.hide.isPending} onClose={() => setHiding(false)}
        onConfirm={(reason) => mod.hide.mutate({ id: comment.id, reason }, { onSuccess: () => setHiding(false), onError: (e) => toast.error(errorMessage(e)) })} />
    </div>
  );
}

