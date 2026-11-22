import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, ExternalLink, Newspaper, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { Spinner } from '@/components/feedback/Spinner';
import { PATHS } from '@/config/paths';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { facebookApi } from '../../api/facebook.api';
import { useFacebookMutation, useFacebookPageDetail, useFacebookPagePosts } from '../../hooks/useFacebook';
import { FacebookPagePostCard } from '../facebook-page-post-card';

/**
 * Chi tiết Fanpage Facebook (`/social/facebook/pages/$pageId`, TEST-206): thông tin trang + BM, trạng thái đồng bộ bài, nút "Đồng bộ bài viết"
 * (100 bài mới nhất — back-end chặn bấm dồn), danh sách bài đã đồng bộ (phân trang). Chỉ HR + người giữ BM; người khác → 404 từ API.
 * TEST-211: mỗi bài có menu Ẩn / Hiện lại / Xoá; bài đã xoá bỏ khỏi danh sách, xem lại ở bộ lọc "Đã xoá".
 */
export function FacebookPageDetailPage() {
  const { pageId } = useParams({ strict: false }) as { pageId: string };
  const detail = useFacebookPageDetail(pageId);
  const [showDeleted, setShowDeleted] = useState(false);
  const pg = usePageState('social-page-posts', showDeleted ? 'deleted' : '');
  const posts = useFacebookPagePosts(pageId, pg.query, showDeleted);
  const sync = useFacebookMutation(() => facebookApi.syncPosts(pageId));
  const [avatarBroken, setAvatarBroken] = useState(false);
  const d = detail.data;
  const items = posts.data?.items ?? [];

  const back = (
    <Button asChild size="sm" variant="ghost"><Link to={PATHS.socialFacebook}><ArrowLeft /> Facebook</Link></Button>
  );

  if (detail.isLoading) return <Spinner />;
  if (!d) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Chi tiết Fanpage" />
        <PageToolbar>{back}</PageToolbar>
        <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="page-detail-missing">
          {errorMessage(detail.error, 'Không tìm thấy trang hoặc bạn không có quyền xem trang này.')}
        </p>
      </div>
    );
  }

  const p = d.page;
  const syncing = d.postsSyncing || sync.isPending;
  return (
    <div className="grid gap-4" data-testid="page-detail">
      <PageHeader title={`Fanpage ${p.name}`} />
      <PageToolbar
        actions={d.canSync && (
          <Button size="sm" loading={syncing} data-testid="page-sync-posts" onClick={async () => {
            try {
              const r = await sync.mutateAsync(undefined);
              if (r.postsSyncError) toast.error(r.postsSyncError);
              else toast.success(`Đã đồng bộ ${r.postCount} bài`);
            } catch (e) { toast.error(errorMessage(e)); }
          }}><RefreshCw /> Đồng bộ bài viết</Button>
        )}
      >{back}</PageToolbar>

      <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center" data-testid="page-detail-head">
        {p.pictureUrl && !avatarBroken
          ? <img src={p.pictureUrl} alt="" referrerPolicy="no-referrer" className="size-16 rounded-full object-cover" onError={() => setAvatarBroken(true)} />
          : <div className="size-16 rounded-full bg-muted" />}
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-lg font-semibold" data-testid="page-detail-name">{p.name}</span>
            {!p.isActive ? <StatusBadge tone="muted">Không còn trong BM</StatusBadge>
              : !p.canPost ? <StatusBadge tone="warning">Thiếu quyền đăng</StatusBadge> : null}
            {d.accountTokenStatus === 'Invalid' && <StatusBadge tone="danger">Token BM lỗi</StatusBadge>}
          </div>
          <div className="text-sm text-muted-foreground">
            {[p.category, `Thuộc ${p.accountName}`, d.holderName ? `Người giữ: ${d.holderName}` : null, `ID ${p.externalId}`].filter(Boolean).join(' · ')}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span data-testid="page-detail-synced">
              {d.postsSyncedAt ? `Đồng bộ bài lúc ${formatDateTime(d.postsSyncedAt)} · ${d.postCount} bài` : 'Chưa đồng bộ bài viết'}
            </span>
            <span>Tự đồng bộ mỗi 5 giờ</span>
            {p.link && (
              <a href={p.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                Mở trên Facebook <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
          {d.postsSyncError && (
            <p className="flex items-start gap-1.5 text-sm text-destructive" data-testid="page-detail-sync-error">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Lỗi đồng bộ bài: {d.postsSyncError}
            </p>
          )}
        </div>
      </section>

      <section className="grid gap-3">
        {(d.deletedCount > 0 || showDeleted) && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc bài" data-testid="page-posts-filter">
            <Button size="sm" variant={showDeleted ? 'outline' : 'secondary'} aria-pressed={!showDeleted} onClick={() => setShowDeleted(false)}>
              Bài trên trang ({d.postCount})
            </Button>
            <Button size="sm" variant={showDeleted ? 'secondary' : 'outline'} aria-pressed={showDeleted} data-testid="page-posts-show-deleted"
              onClick={() => setShowDeleted(true)}>
              <Trash2 /> Đã xoá ({d.deletedCount})
            </Button>
          </div>
        )}
        {posts.isLoading && <Spinner />}
        {!posts.isLoading && items.length === 0 && showDeleted && (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="page-posts-empty">Chưa xoá bài nào.</p>
        )}
        {!posts.isLoading && items.length === 0 && !showDeleted && (
          <div className="grid justify-items-center gap-2 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="page-posts-empty">
            <Newspaper className="size-8" />
            <p>{d.postsSyncedAt ? 'Trang chưa có bài viết nào.' : d.canSync ? 'Chưa có bài nào — bấm "Đồng bộ bài viết" để lấy 100 bài mới nhất từ Facebook.' : 'Chưa có bài nào.'}</p>
          </div>
        )}
        {items.map((x) => <FacebookPagePostCard key={x.id} post={x} pageId={pageId} />)}
        {(posts.data?.total ?? 0) > 0 && (
          <div className="rounded-xl border bg-card"><TablePagination state={pg} total={posts.data?.total} unit="bài" className="border-t-0" /></div>
        )}
      </section>
    </div>
  );
}
