import { Link } from '@tanstack/react-router';
import { timeAgo } from '@/features/notifications';
import type { IPost } from '../../types/news.types';
import { AuthorAvatar } from '../author-avatar';
import { MediaGrid } from '../media-grid';
import { RichContent } from '../rich-content';

/** Bài gốc nằm trong bài chia sẻ. `post` null = người xem không xem được bài gốc (phạm vi khác) hoặc bài đã bị xoá / ẩn. */
export function SharedPost({ post }: { post: IPost | null | undefined }) {
  if (!post) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground" data-testid="shared-unavailable">
        Bài viết gốc không còn hoặc bạn không có quyền xem.
      </div>
    );
  }
  return (
    <div className="grid gap-2 rounded-lg border p-3" data-testid="shared-post">
      <div className="flex items-center gap-2">
        <AuthorAvatar author={post.author} className="size-8" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{post.author.name}</p>
          <Link to="/news/$postId" params={{ postId: post.id }} className="text-xs text-muted-foreground hover:underline">{timeAgo(post.createdAt)}</Link>
        </div>
      </div>
      {post.contentHtml && <div className="max-h-60 overflow-hidden"><RichContent html={post.contentHtml} /></div>}
      {post.media.length > 0 && <MediaGrid media={post.media} />}
    </div>
  );
}
