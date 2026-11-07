export type ConversationType = 'Office' | 'Room' | 'Direct';

export interface IConversation {
  id: string;
  type: ConversationType;
  title: string;
  roomId: string | null;
  peerUserId: string | null;
  lastMessageAt: string | null;
  lastPreview: string | null;
  unread: number;
}

export interface IAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  isImage: boolean;
  /** Presigned GET (ảnh xem ngay); tin đang gửi: blob URL cục bộ. */
  url: string;
}

/** Trạng thái tin do chính mình vừa gửi nhưng server chưa xác nhận. */
export interface ILocalState {
  status: 'sending' | 'failed';
  /** 0..1 — tiến độ tải tệp lên kho. */
  progress: number;
  error?: string;
}

export interface IMessage {
  id: string;
  seq: number;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string | null;
  createdAt: string;
  deleted: boolean;
  attachments: IAttachment[];
  clientId: string | null;
  local?: ILocalState;
}

/** Tin đẩy qua hub (kèm thông tin loại hội thoại). */
export interface IChatMessage extends IMessage {
  conversationType?: ConversationType;
  roomId?: string | null;
  roomName?: string | null;
}

export interface IMessageThread {
  /** Tăng dần theo seq; tin đang gửi (local) nằm cuối. */
  items: IMessage[];
  /** Còn tin cũ hơn để tải. */
  hasMore: boolean;
}

export interface IMessagePage {
  items: IMessage[];
  hasMore: boolean;
}

export interface ISendResult {
  message: IMessage;
  conversationType: ConversationType;
  roomId: string | null;
  roomName: string | null;
  recipients: string[] | null;
}

export interface IPerson {
  userId: string;
  fullName: string;
  code: string;
  departmentName: string | null;
}

export interface IUploadTicket {
  id: string;
  url: string;
  contentType: string;
  expiresAt: string;
}

export type ChatLinkState = 'connecting' | 'online' | 'reconnecting' | 'offline';
