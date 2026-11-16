import { MessageSquare } from 'lucide-react';
import { useChatUnread } from '@/features/chat';
import { useOffice } from '../../store/office.store';

/** Nút chat trên thẻ trạng thái HUD (TEST-126): số tin chưa đọc (cùng badge header `/chat`), bấm = mở / đóng khung chat 3D. */
export function OfficeChatButton() {
  const unread = useChatUnread();
  const open = useOffice((s) => s.chatOpen);
  const setOpen = useOffice((s) => s.setChatOpen);
  return (
    <button type="button" className="office-chat-btn" onClick={() => setOpen(!open)} aria-pressed={open}
      aria-label={`${open ? 'Đóng' : 'Mở'} tin nhắn${unread ? ` (${unread} chưa đọc)` : ''}`} title="Tin nhắn" data-testid="office-chat-button">
      <MessageSquare className="size-[18px]" />
      {unread > 0 && <span className="chat-badge" data-testid="office-chat-button-unread">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
