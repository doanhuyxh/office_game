import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { chatApi, chatKeys } from '../api/chat.api';
import type { IMessageThread } from '../types/chat.types';
import { mergeItems } from '../utils/cache';

/** Danh sách hội thoại (Office đầu, còn lại theo tin mới nhất). Hub cập nhật trực tiếp vào cache; refetch khi vào lại trang. */
export const useConversations = () =>
  useQuery({ queryKey: chatKeys.conversations, queryFn: chatApi.conversations, staleTime: 30_000 });

/** Tổng số tin chưa đọc (badge header / sidebar). Hub cộng dồn vào cache, đánh dấu đã đọc thì trừ. */
export function useChatUnread(): number {
  const { data } = useQuery({ queryKey: chatKeys.unread, queryFn: chatApi.unreadCount, staleTime: 60_000 });
  return data?.count ?? 0;
}

/**
 * Tin của một hội thoại (50 mới nhất; cũ hơn: loadOlder). Cache do hub cập nhật nên refetch luôn GỘP vào cache cũ
 * (giữ tin cũ đã tải + tin đang gửi), trừ khi trang mới không nối được với cache (lỡ quá nhiều tin) → thay hẳn.
 */
export function useMessages(conversationId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: chatKeys.messages(conversationId ?? ''),
    enabled: !!conversationId,
    staleTime: 60_000,
    queryFn: async (): Promise<IMessageThread> => {
      const page = await chatApi.messages(conversationId!);
      const prev = qc.getQueryData<IMessageThread>(chatKeys.messages(conversationId!));
      if (!prev) return { items: page.items, hasMore: page.hasMore };
      const prevServer = prev.items.filter((m) => !m.local);
      const gap = page.hasMore && prevServer.length > 0 && page.items.length > 0 && page.items[0].seq > prevServer[prevServer.length - 1].seq;
      if (gap) return { items: mergeItems(prev.items.filter((m) => m.local), page.items), hasMore: true };
      return { items: mergeItems(prev.items, page.items), hasMore: prev.hasMore };
    },
  });
}

/** Tải thêm tin cũ hơn (trước tin đầu tiên đã có). */
export async function loadOlderMessages(qc: QueryClient, conversationId: string) {
  const key = chatKeys.messages(conversationId);
  const t = qc.getQueryData<IMessageThread>(key);
  const first = t?.items.find((m) => !m.local);
  if (!t?.hasMore || !first) return;
  const page = await chatApi.messages(conversationId, first.seq);
  qc.setQueryData<IMessageThread>(key, (cur) => (cur ? { items: mergeItems(cur.items, page.items), hasMore: page.hasMore } : cur));
}

export const usePeople = (search: string, enabled: boolean) =>
  useQuery({ queryKey: chatKeys.people(search), queryFn: () => chatApi.people(search), enabled, staleTime: 30_000, placeholderData: (prev) => prev });

export function useOpenDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chatApi.openDirect,
    onSuccess: () => qc.invalidateQueries({ queryKey: chatKeys.conversations }),
  });
}
