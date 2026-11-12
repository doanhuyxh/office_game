import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Newspaper, PenLine } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card } from '@/components/common/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { useMe } from '@/features/auth';
import { useTabParam } from '@/hooks/useTabParam';
import { useFeed, useMarkSeen, useNewsUnseenLive } from '../../hooks/useNews';
import { AuthorAvatar } from '../author-avatar';
import { ComposerDialog } from '../composer-dialog';
import { PostCard } from '../post-card';

/** Bảng tin công ty (kiểu Facebook): ô "Bạn đang nghĩ gì?", bài ghim, cuộn vô hạn. Tab "Bài của tôi" lọc bài mình đăng. */
export function NewsPage() {
  const [tab, setTab] = useTabParam('all', ['all', 'mine']);
  const { data: me } = useMe();
  const feed = useFeed(null, tab === 'mine');
  const markSeen = useMarkSeen();
  const [composing, setComposing] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // Bài mới của người khác trong lúc đang xem trang (hỏi lại mỗi 20 giây) → nút "N bài mới" thay vì phải tải lại trang
  const fresh = useNewsUnseenLive(tab === 'all' && feed.isSuccess);
  const showFresh = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void feed.refetch().then(() => markSeen.mutate());
  };

  const pinned = feed.data?.pages[0]?.pinned ?? [];
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const empty = !feed.isLoading && pinned.length === 0 && items.length === 0;

  // Vào trang = đã xem các bài hiện có (xoá badge ở menu)
  useEffect(() => { if (feed.isSuccess && tab === 'all') markSeen.mutate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [feed.isSuccess, tab]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-4">
      <PageHeader title="Bảng tin" />
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar actions={<Button size="sm" onClick={() => setComposing(true)} data-testid="new-post"><PenLine /> Đăng bài</Button>}>
          <TabsList>
            <TabsTrigger value="all">Tất cả</TabsTrigger>
            <TabsTrigger value="mine">Bài của tôi</TabsTrigger>
          </TabsList>
        </PageToolbar>
      </Tabs>

      <Card className="flex-row items-center gap-3 p-3">
        <AuthorAvatar author={{ userId: me?.id ?? '', employeeId: null, name: me?.fullName ?? '', departmentName: null }} className="size-10" />
        <button type="button" className="h-10 flex-1 rounded-full bg-muted/60 px-4 text-left text-sm text-muted-foreground hover:bg-muted" onClick={() => setComposing(true)} data-testid="open-composer">
          {me?.fullName ? `${me.fullName.split(' ').slice(-1)[0]} ơi, bạn muốn chia sẻ điều gì?` : 'Bạn muốn chia sẻ điều gì?'}
        </button>
      </Card>

      {fresh > 0 && tab === 'all' && (
        <div className="sticky top-16 z-10 flex justify-center">
          <Button size="sm" className="rounded-full shadow-md" onClick={showFresh} data-testid="fresh-posts"><ArrowUp /> {fresh} bài mới</Button>
        </div>
      )}
      {feed.isLoading && <Spinner />}
      {feed.isError && <p className="text-center text-sm text-destructive">Không tải được bảng tin. <button type="button" className="underline" onClick={() => feed.refetch()}>Thử lại</button></p>}
      {pinned.map((p) => <PostCard key={p.id} post={p} />)}
      {items.map((p) => <PostCard key={p.id} post={p} />)}
      {empty && (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <Newspaper className="size-10" />
          <p className="text-sm">{tab === 'mine' ? 'Bạn chưa đăng bài nào.' : 'Chưa có bài viết nào. Hãy là người đầu tiên chia sẻ!'}</p>
        </div>
      )}
      <div ref={sentinel} className="flex h-8 items-center justify-center">
        {isFetchingNextPage && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      </div>
      <ComposerDialog open={composing} onOpenChange={setComposing} />
    </div>
  );
}
