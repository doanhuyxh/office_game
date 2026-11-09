import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MessageCircle, Newspaper, Pin } from 'lucide-react';
import { timeAgo } from '@/features/notifications';
import { newsApi, newsKeys } from '../../api/news.api';
import { AuthorAvatar } from '../author-avatar';
import { MediaGrid } from '../media-grid';
import { RichContent } from '../rich-content';

/** Vài bài mới nhất (bài ghim trước) — thẻ gọn ở Tổng quan; `full` hiện đủ nội dung + ảnh/tệp (Bảng tin trong văn phòng 3D). `newTab` mở bài ở tab mới (giữ phiên 3D). */
export function RecentNews({ limit = 3, newTab, full }: { limit?: number; newTab?: boolean; full?: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: [...newsKeys.all, 'recent', limit], queryFn: () => newsApi.feed(null, null, false, limit), staleTime: 30_000 });
  const posts = [...(data?.pinned ?? []), ...(data?.items ?? [])].slice(0, limit);
  if (isLoading) return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  if (posts.length === 0) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Newspaper className="size-4" /> Chưa có bài viết nào.</p>;
  const linkProps = (id: string, className: string) => newTab
    ? { href: `/news/${id}`, target: '_blank', rel: 'noreferrer', className }
    : null;
  if (full) return (
    <ul className="grid gap-4" data-testid="recent-news">
      {posts.map((p) => {
        const head = (
          <>
            <AuthorAvatar author={p.author} className="size-8" />
            <span className="flex min-w-0 items-center gap-1 text-sm font-medium">{p.pinned && <Pin className="size-3 text-primary" />}<span className="truncate">{p.author.name}</span><span className="text-xs font-normal text-muted-foreground">· {timeAgo(p.createdAt)}</span></span>
          </>
        );
        const headCls = 'flex w-fit items-center gap-2 rounded-md hover:underline';
        const a = linkProps(p.id, headCls);
        return (
          <li key={p.id} className="grid gap-2 rounded-xl border bg-card p-3">
            {a ? <a {...a}>{head}</a> : <Link to="/news/$postId" params={{ postId: p.id }} className={headCls}>{head}</Link>}
            {p.contentHtml ? <RichContent html={p.contentHtml} /> : p.plainText && <p className="whitespace-pre-wrap text-sm">{p.plainText}</p>}
            {p.media.length > 0 && <MediaGrid media={p.media} />}
            {p.commentCount > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageCircle className="size-3" />{p.commentCount} bình luận</span>}
          </li>
        );
      })}
    </ul>
  );
  return (
    <ul className="grid gap-3" data-testid="recent-news">
      {posts.map((p) => {
        const body = (
          <>
            <AuthorAvatar author={p.author} className="size-8" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-1 text-sm font-medium">{p.pinned && <Pin className="size-3 text-primary" />}<span className="truncate">{p.author.name}</span><span className="text-xs font-normal text-muted-foreground">· {timeAgo(p.createdAt)}</span></span>
              <span className="line-clamp-2 text-sm text-muted-foreground">{p.plainText || (p.media.length ? `[${p.media.length} tệp đính kèm]` : '')}</span>
              {p.commentCount > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MessageCircle className="size-3" />{p.commentCount}</span>}
            </span>
          </>
        );
        return (
          <li key={p.id}>
            {newTab
              ? <a href={`/news/${p.id}`} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-md hover:bg-accent/50">{body}</a>
              : <Link to="/news/$postId" params={{ postId: p.id }} className="flex items-start gap-2 rounded-md hover:bg-accent/50">{body}</Link>}
          </li>
        );
      })}
    </ul>
  );
}
