import type { QueryClient } from '@tanstack/react-query';
import { chatKeys } from '../api/chat.api';
import type { IConversation, ILocalState, IMessage, IMessageThread } from '../types/chat.types';
import { previewOf } from './labels';

/** Gộp tin mới vào danh sách: khử trùng theo id, tin đang gửi (local) khớp clientId bị thay bằng bản server; local còn lại nằm cuối. */
export function mergeItems(prev: IMessage[], incoming: IMessage[]): IMessage[] {
  const server = new Map<string, IMessage>();
  for (const m of prev) if (!m.local) server.set(m.id, m);
  for (const m of incoming) server.set(m.id, { ...m, local: undefined });
  const clientIds = new Set(incoming.map((m) => m.clientId).filter((c): c is string => !!c));
  const locals = prev.filter((m) => m.local && !(m.clientId && clientIds.has(m.clientId)));
  return [...[...server.values()].sort((a, b) => a.seq - b.seq), ...locals];
}

const updateThread = (qc: QueryClient, conversationId: string, fn: (t: IMessageThread) => IMessageThread) =>
  qc.setQueryData<IMessageThread>(chatKeys.messages(conversationId), (t) => (t ? fn(t) : t));

/** Chèn tin server vào cache của hội thoại (nếu đã tải); trả true nếu hội thoại đã có cache. */
export function upsertMessage(qc: QueryClient, m: IMessage): boolean {
  const had = !!qc.getQueryData(chatKeys.messages(m.conversationId));
  if (had) updateThread(qc, m.conversationId, (t) => ({ ...t, items: mergeItems(t.items, [m]) }));
  return had;
}

export function addLocal(qc: QueryClient, m: IMessage) {
  qc.setQueryData<IMessageThread>(chatKeys.messages(m.conversationId), (t) => ({ hasMore: t?.hasMore ?? false, items: [...(t?.items ?? []), m] }));
}

export function patchLocal(qc: QueryClient, conversationId: string, clientId: string, local: Partial<ILocalState>) {
  updateThread(qc, conversationId, (t) => ({
    ...t,
    items: t.items.map((m) => (m.clientId === clientId && m.local ? { ...m, local: { ...m.local, ...local } } : m)),
  }));
}

export function removeLocal(qc: QueryClient, conversationId: string, clientId: string) {
  updateThread(qc, conversationId, (t) => ({ ...t, items: t.items.filter((m) => !(m.clientId === clientId && m.local)) }));
}

export function markDeleted(qc: QueryClient, conversationId: string, messageId: string) {
  updateThread(qc, conversationId, (t) => ({
    ...t,
    items: t.items.map((m) => (m.id === messageId ? { ...m, deleted: true, text: null, attachments: [] } : m)),
  }));
}

/** Office ghim đầu, còn lại theo tin mới nhất. */
export function sortConversations(list: IConversation[]): IConversation[] {
  return [...list].sort((a, b) => {
    if ((a.type === 'Office') !== (b.type === 'Office')) return a.type === 'Office' ? -1 : 1;
    return (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');
  });
}

/** Cập nhật dòng hội thoại khi có tin mới; trả false nếu danh sách đã tải mà chưa có hội thoại này (cần tải lại). */
export function touchConversation(qc: QueryClient, m: IMessage, addUnread: boolean): boolean {
  const list = qc.getQueryData<IConversation[]>(chatKeys.conversations);
  if (!list) return true;
  if (!list.some((c) => c.id === m.conversationId)) return false;
  qc.setQueryData<IConversation[]>(chatKeys.conversations, sortConversations(list.map((c) =>
    c.id === m.conversationId
      ? { ...c, lastMessageAt: m.createdAt, lastPreview: previewOf(m), unread: c.unread + (addUnread ? 1 : 0) }
      : c)));
  return true;
}

export const adjustUnread = (qc: QueryClient, delta: number) =>
  qc.setQueryData<{ count: number }>(chatKeys.unread, (u) => (u ? { count: Math.max(0, u.count + delta) } : u));
