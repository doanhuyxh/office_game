import { ChatProvider } from '@/features/chat';
import { OfficeView } from '../office-view';

/**
 * Trang /office (toàn màn hình, ngoài MainLayout): bọc ChatProvider để HUD chat dùng chung một kết nối `/rt/hub/chat` như trang /chat
 * (TEST-125). ChatProvider tự bỏ qua nếu đã có provider ở trên → sau này /office vào chung layout vẫn chỉ một kết nối.
 */
export function OfficePage() {
  return (
    <ChatProvider>
      <OfficeView />
    </ChatProvider>
  );
}
