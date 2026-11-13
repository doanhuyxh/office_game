import { http, httpPost } from '@/services/api-client';
import type { IConversation, IGroupMember, IMentionCandidate, IMessage, IMessagePage, IPerson, ISendResult, IUploadTicket } from '../types/chat.types';

const base = '/api/chat';

export const chatKeys = {
  all: ['chat'] as const,
  conversations: ['chat', 'conversations'] as const,
  unread: ['chat', 'unread'] as const,
  messages: (conversationId: string) => ['chat', 'messages', conversationId] as const,
  people: (search: string) => ['chat', 'people', search] as const,
  members: (conversationId: string) => ['chat', 'members', conversationId] as const,
  mentionCandidates: (conversationId: string, search: string) => ['chat', 'mention-candidates', conversationId, search] as const,
  search: (conversationId: string, q: string) => ['chat', 'search', conversationId, q] as const,
};

export const chatApi = {
  conversations: () => http<IConversation[]>(`${base}/conversations`),
  unreadCount: () => http<{ count: number }>(`${base}/unread-count`),
  people: (search: string) => http<IPerson[]>(`${base}/people?search=${encodeURIComponent(search)}`),
  openDirect: (userId: string) => httpPost<IConversation>(`${base}/conversations/direct`, { userId }),
  messages: (conversationId: string, before?: number, take = 50) =>
    http<IMessagePage>(`${base}/conversations/${conversationId}/messages?take=${take}${before !== undefined ? `&before=${before}` : ''}`),
  /** Đường dự phòng khi hub chưa kết nối (tin vẫn được lưu; người khác thấy khi tải lại). Đường chính là hub `Send`. */
  send: (conversationId: string, text: string | null, uploadIds: string[], clientId: string) =>
    httpPost<ISendResult>(`${base}/conversations/${conversationId}/messages`, { text, uploadIds, clientId }),
  remove: (messageId: string) => http<void>(`${base}/messages/${messageId}`, { method: 'DELETE' }),
  /** Dự phòng khi hub chưa kết nối (đường chính: hub `Edit` / `React` để người khác thấy ngay). */
  edit: (messageId: string, text: string) => http<ISendResult>(`${base}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
  react: (messageId: string, emoji: string) => httpPost<ISendResult>(`${base}/messages/${messageId}/reactions`, { emoji }),
  search: (conversationId: string, q: string) => http<IMessage[]>(`${base}/conversations/${conversationId}/search?q=${encodeURIComponent(q)}`),
  createGroup: (title: string, userIds: string[]) => httpPost<IConversation>(`${base}/conversations/group`, { title, userIds }),
  members: (conversationId: string) => http<IGroupMember[]>(`${base}/conversations/${conversationId}/members`),
  /** Gợi ý @nhắc: thành viên hội thoại (trừ mình), tìm không dấu theo tên / mã. */
  mentionCandidates: (conversationId: string, search: string) =>
    http<IMentionCandidate[]>(`${base}/conversations/${conversationId}/mention-candidates?search=${encodeURIComponent(search)}`),
  addMembers: (conversationId: string, userIds: string[]) => httpPost<void>(`${base}/conversations/${conversationId}/members`, { userIds }),
  leaveGroup: (conversationId: string) => http<void>(`${base}/conversations/${conversationId}/members/me`, { method: 'DELETE' }),
  markRead: (conversationId: string) => httpPost<void>(`${base}/conversations/${conversationId}/read`),
  upload: (conversationId: string, file: File) =>
    httpPost<IUploadTicket>(`${base}/uploads`, { conversationId, fileName: file.name, contentType: file.type || null, size: file.size }),
  attachmentUrl: (id: string, download: boolean) => http<{ url: string }>(`${base}/attachments/${id}/url?download=${download}`),
};
