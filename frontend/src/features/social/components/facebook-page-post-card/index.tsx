import { useState } from 'react';
import { ExternalLink, ImageOff, MessageCircle, Share2, ThumbsUp } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import type { IFacebookPagePost } from '../../types/facebook.types';

const num = (n: number) => n.toLocaleString('vi-VN');

/**
 * Một bài viết hiện có trên Fanpage (đồng bộ từ Facebook — TEST-206): ảnh đại diện (link CDN Facebook, hỏng → ảnh thay thế), nội dung rút gọn
 * + "Xem thêm", giờ đăng (giờ VN), số thích / bình luận / chia sẻ, nhãn "Đăng từ OfficeHub", link mở bài.
 */
export function FacebookPagePostCard({ post }: { post: IFacebookPagePost }) {
  const [expanded, setExpanded] = useState(false);
  const [broken, setBroken] = useState(false);
  const long = (post.message?.length ?? 0) > 240 || (post.message?.split('\n').length ?? 0) > 4;
  return (
    <article className="flex gap-3 rounded-xl border bg-card p-3 sm:p-4" data-testid="page-post">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-muted sm:size-20">
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
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noopener noreferrer" className="ms-auto inline-flex items-center gap-1 text-primary hover:underline">
              Mở bài <ExternalLink className="size-3.5" />
            </a>
          )}
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
          <span className="inline-flex items-center gap-1" title="Bình luận"><MessageCircle className="size-3.5" /> {num(post.commentCount)}</span>
          <span className="inline-flex items-center gap-1" title="Chia sẻ"><Share2 className="size-3.5" /> {num(post.shareCount)}</span>
        </div>
      </div>
    </article>
  );
}
