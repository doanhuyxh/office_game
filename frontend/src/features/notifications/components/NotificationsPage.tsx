import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import { Button } from '@/components/common/button';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Tabs, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/date';
import { useMarkAllRead, useMarkRead, useNotificationsPage } from '../hooks/useNotifications';
import type { INotification } from '../types/notification.types';
import { CATEGORY, FALLBACK, timeAgo } from '../utils/labels';

type Filter = 'all' | 'unread';

/** Toàn bộ thông báo của tôi (chuông chỉ hiện 20 mới nhất): lọc Tất cả / Chưa đọc, phân trang ở BE. Bấm mục → đánh dấu đọc + mở link. */
export function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const pg = usePageState('notifications', filter);
  const { data, isLoading } = useNotificationsPage(filter === 'unread', pg.query);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  const open = (n: INotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.link) void navigate({ to: n.link });
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Thông báo" />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <PageToolbar
          actions={unread > 0 && (
            <Button variant="outline" size="sm" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
              <CheckCheck /> Đánh dấu tất cả đã đọc
            </Button>
          )}>
          <TabsList>
            <TabsTrigger value="all">Tất cả</TabsTrigger>
            <TabsTrigger value="unread">Chưa đọc{unread > 0 && ` (${unread > 99 ? '99+' : unread})`}</TabsTrigger>
          </TabsList>
        </PageToolbar>
      </Tabs>
      <div className="rounded-xl border bg-card">
        {isLoading ? <div className="py-10"><Spinner /></div> : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
            <BellOff className="size-8" />{filter === 'unread' ? 'Không còn thông báo chưa đọc.' : 'Chưa có thông báo nào.'}
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((n) => {
              const c = CATEGORY[n.category] ?? FALLBACK;
              return (
                <li key={n.id} className={cn('flex items-start gap-3 px-4 py-3', !n.read && 'bg-primary/5')} data-testid="notification-row">
                  <c.icon className={cn('mt-0.5 size-4 shrink-0', c.className)} />
                  <button type="button" className="grid min-w-0 flex-1 gap-0.5 text-left" onClick={() => open(n)}>
                    <span className={cn('text-sm leading-snug', !n.read && 'font-semibold', n.link && 'hover:underline')}>{n.title}</span>
                    <span className="text-sm whitespace-pre-line text-muted-foreground">{n.body}</span>
                    <span className="text-xs text-muted-foreground/80" title={formatDateTime(n.createdAt)}>{timeAgo(n.createdAt)}</span>
                  </button>
                  {!n.read && (
                    <Button variant="ghost" size="icon-sm" aria-label="Đánh dấu đã đọc" title="Đánh dấu đã đọc" disabled={markRead.isPending}
                      onClick={() => markRead.mutate(n.id)}>
                      <Check />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <TablePagination state={pg} total={data?.total} unit="thông báo" />
      </div>
    </div>
  );
}
