import { Link } from '@tanstack/react-router';
import { Megaphone } from 'lucide-react';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { PageHeader } from '@/components/layout/PageHeader';
import { Spinner } from '@/components/feedback/Spinner';
import { PATHS } from '@/config/paths';
import { useMe } from '@/features/auth';
import { useSocialPages, useSocialPosts } from '../../hooks/useSocial';
import { PostCard } from '../post-card';
import { PostComposer } from '../post-composer';

/**
 * Đăng bài lên Fanpage Facebook (qua Business Manager của công ty). HR: mọi trang; nhân viên: trang của BM đang được bàn giao.
 * Trái: soạn bài; phải: bài đã gửi + kết quả từng trang (tự làm mới khi đang đăng).
 */
export function SocialPage() {
  const me = useMe();
  const isHr = !!me.data?.roles.some((r) => r === 'admin' || r === 'hr');
  const pages = useSocialPages();
  const pg = usePageState('social-posts');
  const posts = useSocialPosts(pg.query);
  const list = pages.data ?? [];
  const items = posts.data?.items ?? [];

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Đăng bài mạng xã hội" />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-4">
          {pages.isLoading ? <Spinner /> : list.length > 0 ? <PostComposer pages={list} /> : (
            <div className="grid justify-items-center gap-2 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground" data-testid="social-empty">
              <Megaphone className="size-8" />
              {isHr
                ? <p>Chưa có Fanpage nào. Thêm Business Manager và token ở <Link to={PATHS.assets} search={{ tab: 'social' }} className="text-primary hover:underline">Tài sản → MXH</Link>.</p>
                : <p>Bạn chưa được bàn giao Business Manager nào. Liên hệ HR để được giao.</p>}
            </div>
          )}
        </div>
        <section className="grid gap-3">
          {posts.isLoading && <Spinner />}
          {!posts.isLoading && items.length === 0 && (
            <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">Chưa có bài nào.</p>
          )}
          {items.map((p) => <PostCard key={p.id} post={p} />)}
          {(posts.data?.total ?? 0) > 0 && (
            <div className="rounded-xl border bg-card"><TablePagination state={pg} total={posts.data?.total} unit="bài" className="border-t-0" /></div>
          )}
        </section>
      </div>
    </div>
  );
}
