import { createContext } from 'react';
import type { ChatLinkState, IChatMessage, IMessage } from '../types/chat.types';

/** Nghe tin mới của NGƯỜI KHÁC do hub đẩy; `viewing` = hội thoại đó đang mở trên màn hình (tab đang hiện). */
export type IncomingListener = (message: IChatMessage, viewing: boolean) => void;

export interface IChatContext {
  link: ChatLinkState;
  /** Hội thoại đang mở trên màn hình (null = không xem chat) — quyết định có cộng "chưa đọc" / phát âm hay không. */
  setActive(conversationId: string | null): void;
  /**
   * Gửi lạc quan: hiện ngay ở trạng thái "đang gửi", tải tệp (nếu có) rồi gửi qua hub (chưa nối → REST). `conversationId` = Guid hoặc
   * bí danh "office" / "room:<id>". Kênh phòng lỗi → tự thử lại một lần sau 1,5 giây. Kết quả: true = đã lưu, false = lỗi (tin ở trạng thái failed).
   */
  send(conversationId: string, text: string, files: File[]): Promise<boolean>;
  retry(conversationId: string, clientId: string): void;
  discard(conversationId: string, clientId: string): void;
  /** Thu hồi tin của mình (xoá mềm). */
  recall(message: IMessage): Promise<void>;
  /** Sửa nội dung tin của mình (trong 24 giờ); true = đã lưu. */
  edit(message: IMessage, text: string): Promise<boolean>;
  /** Thả / gỡ cảm xúc (bấm lại cùng emoji = gỡ). */
  react(message: IMessage, emoji: string): void;
  markRead(conversationId: string): void;
  /** Đăng ký nghe tin mới của người khác (vd toast "X nhắn bạn" trong văn phòng 3D — TEST-126); trả hàm huỷ. Âm báo vẫn do provider phát. */
  subscribe(listener: IncomingListener): () => void;
}

export const ChatContext = createContext<IChatContext | null>(null);
