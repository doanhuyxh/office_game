import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { EyeOff, Megaphone, MessageCircle, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Card } from '@/components/common/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/common/tooltip';
import { timeAgo } from '@/features/notifications';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { useDeletePost, useModeratePost, useReactPost } from '../../hooks/useNews';
import type { IPost } from '../../types/news.types';
import { AUDIENCE } from '../../utils/labels';
import { AuthorAvatar } from '../author-avatar';
import { CommentsSection } from '../comments-section';
import { ComposerDialog } from '../composer-dialog';
import { MediaGrid } from '../media-grid';
import { ReactionButton, ReactionSummaryLine } from '../reaction-bar';
import { ReasonDialog } from '../reason-dialog';
import { RichContent } from '../rich-content';

const COLLAPSE_CHARS = 500;

/** Một bài trên bảng tin (kiểu Facebook). `expanded` = trang chi tiết: hiện đủ nội dung + mở sẵn bình luận. */
export function PostCard({ post, expanded, focusComment }: { post: IPost; expanded?: boolean; focusComment?: string | null }) {
  const [showComments, setShowComments] = useState(!!expanded);
  const [more, setMore] = useState(!!expanded);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hiding, setHiding] = useState(false);
  const react = useReactPost();
  const del = useDeletePost();
  const mod = useModeratePost();
  const Aud = AUDIENCE[post.audience].icon;
  const long = post.plainText.length > COLLAPSE_CHARS || post.plainText.split('\n').length > 8;
  const canPin = post.canHide && post.audience === 'Company' && !post.hidden;
  const hasMenu = post.canEdit || post.canDelete || post.canHide;
  const audienceNames = post.audience === 'Company' || post.audience === 'Private' ? AUDIENCE[post.audience].hint : post.targets.map((t) => t.name).join(', ');
  const fail = (e: unknown) => toast.error(errorMessage(e));

  return (
    <Card className={cn('gap-3 p-4', post.hidden && 'border-warning/60')} data-testid="post-card" data-post-id={post.id}>
      {post.pinned && <p className="-mb-1 flex items-center gap-1 text-xs font-medium text-primary"><Pin className="size-3" /> Bài được ghim</p>}
      <div className="flex items-start gap-3">
        <AuthorAvatar author={post.author} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{post.author.name}</p>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            {post.author.departmentName && <span>{post.author.departmentName} ·</span>}
            <Link to="/news/$postId" params={{ postId: post.id }} className="hover:underline" title={new Date(post.createdAt).toLocaleString('vi-VN')}>{timeAgo(post.createdAt)}</Link>
            {post.editedAt && <span>· đã chỉnh sửa</span>}
            <span>·</span>
            <Tooltip>
              <TooltipTrigger asChild><span className="inline-flex items-center gap-1" data-testid="post-audience"><Aud className="size-3" />{AUDIENCE[post.audience].label}</span></TooltipTrigger>
              <TooltipContent className="max-w-xs">{audienceNames}</TooltipContent>
            </Tooltip>
            {post.emailSent && <Tooltip><TooltipTrigger asChild><Megaphone className="size-3" aria-label="Đã gửi email" /></TooltipTrigger><TooltipContent>Đã gửi email cho người xem</TooltipContent></Tooltip>}
          </p>
        </div>
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Tuỳ chọn bài viết" data-testid="post-menu"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {post.canEdit && !post.hidden && <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil /> Sửa bài</DropdownMenuItem>}
              {canPin && (post.pinned
                ? <DropdownMenuItem onSelect={() => mod.unpin.mutate(post.id, { onError: fail })}><PinOff /> Bỏ ghim</DropdownMenuItem>
                : <DropdownMenuItem onSelect={() => mod.pin.mutate({ id: post.id, days: 7 }, { onSuccess: () => toast.success('Đã ghim bài 7 ngày'), onError: fail })}><Pin /> Ghim 7 ngày</DropdownMenuItem>)}
              {post.canHide && (post.hidden
                ? <DropdownMenuItem onSelect={() => mod.unhide.mutate(post.id, { onError: fail })}><EyeOff /> Hiện lại bài</DropdownMenuItem>
                : <DropdownMenuItem onSelect={() => setHiding(true)}><EyeOff /> Ẩn bài (quản trị)</DropdownMenuItem>)}
              {post.canDelete && <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}><Trash2 /> Xoá bài</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {post.hidden && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning" data-testid="hidden-banner">
          Bài đã bị ẩn bởi quản trị{post.hiddenReason ? `: ${post.hiddenReason}` : ''}. Chỉ tác giả và quản trị xem được.
        </p>
      )}

      {post.contentHtml && (
        <div className="relative">
          <div className={cn(!more && long && 'max-h-60 overflow-hidden')}><RichContent html={post.contentHtml} /></div>
          {!more && long && <div className="pointer-events-none absolute inset-x-0 bottom-6 h-10 bg-gradient-to-t from-card to-transparent" />}
          {long && !expanded && <button type="button" className="mt-1 text-sm font-medium text-muted-foreground hover:underline" onClick={() => setMore((m) => !m)}>{more ? 'Thu gọn' : 'Xem thêm'}</button>}
        </div>
      )}
      {post.media.length > 0 && <MediaGrid media={post.media} />}

      {(post.reactionCount > 0 || post.commentCount > 0) && (
        <div className="flex items-center justify-between">
          <ReactionSummaryLine kind="posts" id={post.id} total={post.reactionCount} counts={post.reactions} />
          {post.commentCount > 0 && (
            <button type="button" className="ms-auto text-sm text-muted-foreground hover:underline" onClick={() => setShowComments((s) => !s)} data-testid="comment-count">{post.commentCount} bình luận</button>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 border-y py-0.5">
        <ReactionButton mine={post.myReaction} disabled={react.isPending || post.hidden} onReact={(type) => react.mutate({ id: post.id, type }, { onError: fail })} />
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent" onClick={() => setShowComments((s) => !s)} data-testid="toggle-comments">
          <MessageCircle className="size-4" /> Bình luận
        </button>
      </div>
      {showComments && <CommentsSection postId={post.id} disabled={post.commentsDisabled || post.hidden} focusId={focusComment} />}

      {editing && <ComposerDialog open post={post} onOpenChange={setEditing} />}
      <ReasonDialog open={hiding} title="Ẩn bài viết" description="Tác giả sẽ nhận được lý do này. Bài vẫn hiện với tác giả và quản trị." confirmLabel="Ẩn bài"
        busy={mod.hide.isPending} onClose={() => setHiding(false)}
        onConfirm={(reason) => mod.hide.mutate({ id: post.id, reason }, { onSuccess: () => setHiding(false), onError: fail })} />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá bài viết?</AlertDialogTitle>
            <AlertDialogDescription>Bài viết và bình luận sẽ không còn hiển thị với mọi người.{post.canDelete && !post.canEdit ? ' Tác giả sẽ được báo.' : ''}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate(post.id, { onSuccess: () => toast.success('Đã xoá bài'), onError: fail })} data-testid="confirm-delete">Xoá</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
