import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Megaphone, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { PageHeader } from '@/components/layout/PageHeader';
import { Spinner } from '@/components/feedback/Spinner';
import { PATHS } from '@/config/paths';
import { FACEBOOK_PLATFORM } from '@/config/social-platforms';
import { useMe } from '@/features/auth';
import { useFacebookPages, useFacebookPostCounts, useFacebookPosts } from '../../hooks/useFacebook';
import { FacebookPostCard } from '../facebook-post-card';
import { FacebookPageList } from '../facebook-page-list';
import { FacebookPostComposer } from '../facebook-post-composer';

/**
 * Trang Facebook (`/social/facebook`, TEST-207 — `/social` cũ chuyển hướng tới đây). Đăng bài lên Fanpage Facebook (qua Business Manager của công ty). HR: mọi trang; nhân viên: trang của BM đang được bàn giao.
 * Trái: soạn bài; phải: bài đã gửi + kết quả từng trang (tự làm mới khi đang đăng).
 * TEST-214: bài xoá khỏi danh sách; HR / Quản trị viên xem lại ở bộ lọc "Đã xoá (N)".
 */
export function FacebookPostsPage() {
  const me = useMe();
  const isHr = !!me.data?.roles.some((r) => r === 'admin' || r === 'hr');
  const pages = useFacebookPages();
  const [showDeleted, setShowDeleted] = useState(false);
  const deleted = isHr && showDeleted;
  const counts = useFacebookPostCounts(isHr);
  const deletedCount = counts.data?.deletedCount ?? 0;
  const pg = usePageState('social-posts', deleted ? 'deleted' : '');
  const posts = useFacebookPosts(pg.query, deleted);
  const list = pages.data ?? [];
  const items = posts.data?.items ?? [];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Facebook — đăng bài lên Fanpage" />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="grid gap-4 lg:sticky lg:top-4">
          {pages.isLoading ? <Spinner /> : list.length > 0 ? <><FacebookPostComposer pages={list} /><FacebookPageList pages={list} /></> : (
            <div className="grid justify-items-center gap-2 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="social-empty">
              <Megaphone className="size-8" />
              {isHr
                ? <p>Chưa có Fanpage Facebook nào. Thêm {FACEBOOK_PLATFORM.label} và token ở <Link to={PATHS.assets} search={{ tab: 'social', platform: FACEBOOK_PLATFORM.key }} className="text-primary hover:underline">Tài sản → MXH</Link>.</p>
                : <p>Bạn chưa được bàn giao {FACEBOOK_PLATFORM.label} nào. Liên hệ HR để được giao.</p>}
            </div>
          )}
        </div>
        <section className="grid gap-3">
          {isHr && (deletedCount > 0 || deleted) && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc bài" data-testid="social-posts-filter">
              <Button size="sm" variant={deleted ? 'outline' : 'secondary'} aria-pressed={!deleted} onClick={() => setShowDeleted(false)}>Bài đăng</Button>
              <Button size="sm" variant={deleted ? 'secondary' : 'outline'} aria-pressed={deleted} data-testid="social-posts-show-deleted"
                onClick={() => setShowDeleted(true)}>
                <Trash2 /> Đã xoá ({deletedCount})
              </Button>
            </div>
          )}
          {posts.isLoading && <Spinner />}
          {!posts.isLoading && items.length === 0 && (
            <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="social-posts-empty">
              {deleted ? 'Chưa xoá bài nào.' : 'Chưa có bài nào.'}
            </p>
          )}
          {items.map((p) => <FacebookPostCard key={p.id} post={p} />)}
          {(posts.data?.total ?? 0) > 0 && (
            <div className="rounded-xl border bg-card"><TablePagination state={pg} total={posts.data?.total} unit="bài" className="border-t-0" /></div>
          )}
        </section>
      </div>
    </div>
  );
}
