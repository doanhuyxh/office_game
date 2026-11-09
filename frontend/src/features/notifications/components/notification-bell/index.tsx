import { useNavigate } from '@tanstack/react-router';
import { Bell, BellOff, BellRing, CheckCheck, Volume2, VolumeX } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { PATHS } from '@/config/paths';
import { cn } from '@/utils/cn';
import { useNotificationSound } from '../../hooks/useNotificationSound';
import { useMarkAllRead, useMarkRead, useNotifications } from '../../hooks/useNotifications';
import { usePush } from '../../hooks/usePush';
import type { INotification } from '../../types/notification.types';
import { CATEGORY, FALLBACK, linkTarget, timeAgo } from '../../utils/labels';

/** Chuông thông báo trên header: badge số chưa đọc, danh sách 20 thông báo mới nhất + "Xem tất cả" → /notifications. Bấm một thông báo → đánh dấu đã đọc + mở link. */
export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const [soundOn, setSoundOn] = useNotificationSound();
  const push = usePush();
  const navigate = useNavigate();
  const unread = data?.unreadCount ?? 0;
  const items = data?.items ?? [];
  // Mobile: chuông không nằm sát mép phải (còn nút theme, avatar) → menu căn theo chuông bị lệch trái.
  // Đo lúc mở, đẩy menu sang phải cho sát mép phải màn hình (cách 8px).
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [alignOffset, setAlignOffset] = useState(0);
  const onOpenChange = (o: boolean) => {
    if (!o) return;
    const r = triggerRef.current?.getBoundingClientRect();
    setAlignOffset(r && window.innerWidth < 640 ? Math.min(0, r.right - window.innerWidth + 8) : 0);
  };

  const open = (n: INotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.link) void navigate(linkTarget(n.link));
  };

  return (
    <DropdownMenu modal={false} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} variant="ghost" size="icon" className="relative rounded-full" aria-label={`Thông báo${unread ? ` (${unread} chưa đọc)` : ''}`} data-testid="notification-bell">
          <Bell className="size-[1.2rem]" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white" data-testid="notification-unread">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" alignOffset={alignOffset} collisionPadding={8} className="w-88 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm">Thông báo</DropdownMenuLabel>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={markAll.isPending}
                onClick={(e) => { e.preventDefault(); markAll.mutate(); }}>
                <CheckCheck /> Đánh dấu đã đọc
              </Button>
            )}
            <Button variant="ghost" size="icon" className="size-7" aria-label={soundOn ? 'Tắt âm thanh thông báo' : 'Bật âm thanh thông báo'}
              aria-pressed={soundOn} data-testid="notification-sound-toggle"
              onClick={(e) => { e.preventDefault(); setSoundOn(!soundOn); }}>
              {soundOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4 text-muted-foreground" />}
            </Button>
            {push.supported && (
              <Button variant="ghost" size="icon" className="size-7" aria-label={push.enabled ? 'Tắt thông báo đẩy' : 'Bật thông báo đẩy'}
                aria-pressed={push.enabled} data-testid="notification-push-toggle"
                onClick={async (e) => {
                  e.preventDefault();
                  if (push.enabled) await push.disable();
                  else if (!(await push.enable())) toast.error('Trình duyệt chặn quyền thông báo — vào cài đặt trình duyệt để cho phép');
                }}>
                {push.enabled ? <BellRing className="size-4" /> : <BellOff className="size-4 text-muted-foreground" />}
              </Button>
            )}
          </div>
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Chưa có thông báo nào</p>}
          {items.map((n) => {
            const c = CATEGORY[n.category] ?? FALLBACK;
            return (
              <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="items-start gap-3 py-2.5" data-testid="notification-item">
                <c.icon className={cn('mt-0.5 size-4 shrink-0', c.className)} />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className={cn('text-sm leading-snug', !n.read && 'font-semibold')}>{n.title}</span>
                  <span className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{n.body}</span>
                  <span className="text-[11px] text-muted-foreground/80">{timeAgo(n.createdAt)}</span>
                </div>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Chưa đọc" />}
              </DropdownMenuItem>
            );
          })}
        </div>
        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuItem onSelect={() => void navigate({ to: PATHS.notifications })} className="justify-center rounded-none py-2 text-sm text-primary" data-testid="notification-all">
          Xem tất cả thông báo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
