import { useContext } from 'react';
import { ChatContext, type IChatContext } from '../context/chat-context';

/** Trạng thái kết nối chat + gửi / thu hồi / đánh dấu đã đọc. Chỉ dùng được bên trong <ChatProvider> (MainLayout). */
export function useChat(): IChatContext {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat phải nằm trong <ChatProvider>');
  return ctx;
}
