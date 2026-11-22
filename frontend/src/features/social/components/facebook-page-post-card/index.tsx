import { useState } from 'react';
import { ExternalLink, Eye, EyeOff, ImageOff, MessageCircle, MoreHorizontal, Share2, ThumbsUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { facebookApi } from '../../api/facebook.api';
import { useFacebookMutation } from '../../hooks/useFacebook';
import type { IFacebookPagePost } from '../../types/facebook.types';
import { FacebookPostComments } from '../facebook-post-comments';

const num = (n: number) => n.toLocaleString('vi-VN');

type Action = 'hide' | 'unhide' | 'delete';

/** "bởi Tên lúc 22/11/2026 10:00" (bỏ phần thiếu). */
const by = (name: string | null, at: string | null) =>
  [name ? `bởi ${name}` : null, at ? `lúc ${formatDateTime(at)}` : null].filter(Boolean).join(' ');

/**
 * Một bài viết hiện có trên Fanpage (đồng bộ từ Facebook — TEST-206): ảnh đại diện (link CDN Facebook, hỏng → ảnh thay thế), nội dung rút gọn
 * + "Xem thêm", giờ đăng (giờ VN), số thích / bình luận / chia sẻ, nhãn "Đăng từ OfficeHub", link mở bài.
 * TEST-211: menu ⋯ Ẩn khỏi trang / Hiện lại / Xoá trên Facebook (back-end kiểm tra quyền + gọi Facebook; `canModerate` chỉ để hiện menu),
 * xoá qua hộp xác nhận destructive; nhãn "Đã ẩn · bởi … lúc …"; bài đã xoá (bộ lọc "Đã xoá") có nhãn "Đã xoá · bởi … lúc …".
 * TEST-212: bấm số bình luận → mở khung bình luận ngay dưới thẻ (lấy thẳng từ Facebook, trả lời dưới tên Trang); bài đã xoá không mở.
 */
export function FacebookPagePostCard({ post, pageId }: { post: IFacebookPagePost; pageId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [broken, setBroken] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const act = useFacebookMutation((a: Action) =>
    a === 'hide' ? facebookApi.hidePagePost(pageId, post.id)
      : a === 'unhide' ? facebookApi.unhidePagePost(pageId, post.id)
        : facebookApi.deletePagePost(pageId, post.id));
  const long = (post.message?.length ?? 0) > 240 || (post.message?.split('\n').length ?? 0) > 4;

  const toggleHidden = async (a: 'hide' | 'unhide') => {
    try {
      await act.mutateAsync(a);
      toast.success(a === 'hide' ? 'Đã ẩn bài khỏi dòng thời gian của trang' : 'Đã hiện lại bài trên trang');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const remove = async () => {
    if (await confirmDialog({
      title: 'Xoá bài này trên Facebook?',
      description: 'Xoá vĩnh viễn trên Facebook, không khôi phục được. Bài bị gỡ khỏi trang và khỏi danh sách (xem lại ở bộ lọc "Đã xoá").',
      confirmText: 'Xoá', destructive: true, onConfirm: () => act.mutateAsync('delete'),
    })) toast.success('Đã xoá bài trên Facebook');
  };

  return (
    <article className={`grid gap-3 rounded-xl border bg-card p-3 sm:p-4 ${post.isHidden || post.deletedAt ? 'border-dashed' : ''}`} data-testid="page-post"
      data-hidden={post.isHidden ? 'true' : undefined} data-deleted={post.deletedAt ? 'true' : undefined}>
      <div className="flex gap-3">
        <div className={`size-16 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-20 ${post.isHidden || post.deletedAt ? 'opacity-60' : ''}`}>
          {post.pictureUrl && !broken ? (
            <img src={post.pictureUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(true)} />
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground" data-testid="page-post-no-image"><ImageOff className="size-5" /></div>
          )}
        </div>
        <div className="grid min-w-0 flex-1 content-start gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{formatDateTime(post.createdTime)}</span>
            {post.fromOfficeHub && <StatusBadge tone="info" className="text-[11px]">Đăng từ OfficeHub</StatusBadge>}
            {post.deletedAt ? (
              <span data-testid="page-post-deleted">
                <StatusBadge tone="danger" className="text-[11px]">{['Đã xoá', by(post.deletedByName, post.deletedAt)].filter(Boolean).join(' · ')}</StatusBadge>
              </span>
            ) : post.isHidden && (
              <span data-testid="page-post-hidden">
                <StatusBadge tone="warning" className="text-[11px]">{['Đã ẩn', by(post.hiddenByName, post.hiddenAt) || 'trên Facebook'].join(' · ')}</StatusBadge>
              </span>
            )}
            <span className="ms-auto inline-flex items-center gap-2">
              {post.permalink && !post.deletedAt && (
                <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                  Mở bài <ExternalLink className="size-3.5" />
                </a>
              )}
              {post.canModerate && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="size-7" aria-label="Thao tác với bài" data-testid="page-post-menu" loading={act.isPending}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {post.isHidden ? (
                      <DropdownMenuItem data-testid="page-post-unhide" onSelect={() => void toggleHidden('unhide')}><Eye /> Hiện lại trên trang</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem data-testid="page-post-hide" onSelect={() => void toggleHidden('hide')}><EyeOff /> Ẩn khỏi trang</DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" data-testid="page-post-delete" onSelect={() => void remove()}>
                      <Trash2 /> Xoá trên Facebook…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </span>
          </div>
          {post.message ? (
            <div className="text-sm">
              <p className={`break-words whitespace-pre-line ${expanded ? '' : 'line-clamp-3'}`} data-testid="page-post-message">{post.message}</p>
              {long && (
                <button type="button" className="mt-0.5 text-xs font-medium text-primary hover:underline" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? 'Thu gọn' : 'Xem thêm'}
                </button>
              )}
            </div>
          ) : <p className="text-sm text-muted-foreground italic">(Không có nội dung chữ)</p>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="page-post-stats">
            <span className="inline-flex items-center gap-1" title="Lượt thích / cảm xúc"><ThumbsUp className="size-3.5" /> {num(post.reactionCount)}</span>
            {post.deletedAt ? (
              <span className="inline-flex items-center gap-1" title="Bình luận"><MessageCircle className="size-3.5" /> {num(post.commentCount)}</span>
            ) : (
              <button type="button" className={`inline-flex items-center gap-1 rounded hover:text-foreground hover:underline ${showComments ? 'font-semibold text-foreground' : ''}`}
                title={showComments ? 'Ẩn bình luận' : 'Xem bình luận'} aria-expanded={showComments} data-testid="page-post-comments-toggle"
                onClick={() => setShowComments((v) => !v)}>
                <MessageCircle className="size-3.5" /> {num(post.commentCount)} bình luận
              </button>
            )}
            <span className="inline-flex items-center gap-1" title="Chia sẻ"><Share2 className="size-3.5" /> {num(post.shareCount)}</span>
          </div>
        </div>
      </div>
      {showComments && !post.deletedAt && <FacebookPostComments pageId={pageId} postId={post.id} />}
    </article>
  );
}
