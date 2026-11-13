import { Link, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Spinner } from '@/components/feedback/Spinner';
import { NotFoundPage } from '@/components/feedback/NotFoundPage';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { PATHS } from '@/config/paths';
import { ApiError } from '@/services/api-client';
import { usePost } from '../../hooks/useNews';
import { PostCard } from '../post-card';

/** Một bài (link từ email / thông báo): `?comment=<id>` cuộn tới bình luận. Bài ngoài phạm vi / đã xoá → 404. */
export function PostPage() {
  const { postId } = useParams({ strict: false }) as { postId: string };
  const search = useSearch({ strict: false }) as { comment?: unknown };
  const { data, isLoading, error } = usePost(postId);

  if (isLoading) return <Spinner />;
  if (!data) return error instanceof ApiError && error.status !== 404 ? <p className="text-center text-sm text-destructive">Không tải được bài viết.</p> : <NotFoundPage />;
  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-4 @min-[96rem]/content:mx-0">
      <PageHeader title="Bài viết" />
      <PageToolbar>
        <Button asChild variant="ghost" size="sm"><Link to={PATHS.news}><ArrowLeft /> Bảng tin</Link></Button>
      </PageToolbar>
      <PostCard post={data} expanded focusComment={typeof search.comment === 'string' ? search.comment : null} />
    </div>
  );
}
