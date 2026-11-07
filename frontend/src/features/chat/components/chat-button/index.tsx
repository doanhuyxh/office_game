import { Link } from '@tanstack/react-router';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/common/button';
import { PATHS } from '@/config/paths';
import { useChatUnread } from '../../hooks/useChatData';

/** Nút chat trên header (cạnh chuông thông báo): badge tổng tin chưa đọc, bấm → /chat. */
export function ChatButton() {
  const unread = useChatUnread();
  return (
    <Button asChild variant="ghost" size="icon" className="relative rounded-full">
      <Link to={PATHS.chat} aria-label={`Tin nhắn${unread ? ` (${unread} chưa đọc)` : ''}`} data-testid="chat-bell">
        <MessageSquare className="size-[1.2rem]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white" data-testid="chat-unread">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}
