import { createContext } from 'react';
import type { ChatLinkState, IMessage } from '../types/chat.types';

export interface IChatContext {
  link: ChatLinkState;
  /** Hội thoại đang mở trên màn hình (null = không xem chat) — quyết định có cộng "chưa đọc" / phát âm hay không. */
  setActive(conversationId: string | null): void;
  /** Gửi lạc quan: hiện ngay ở trạng thái "đang gửi", tải tệp (nếu có) rồi gửi qua hub. */
  send(conversationId: string, text: string, files: File[]): void;
  retry(conversationId: string, clientId: string): void;
  discard(conversationId: string, clientId: string): void;
  /** Thu hồi tin của mình (xoá mềm). */
  recall(message: IMessage): Promise<void>;
  /** Sửa nội dung tin của mình (trong 24 giờ); true = đã lưu. */
  edit(message: IMessage, text: string): Promise<boolean>;
  /** Thả / gỡ cảm xúc (bấm lại cùng emoji = gỡ). */
  react(message: IMessage, emoji: string): void;
  markRead(conversationId: string): void;
}

export const ChatContext = createContext<IChatContext | null>(null);
