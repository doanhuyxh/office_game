import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { newsApi, newsKeys } from '../api/news.api';
import type { IComment, IFeed, IPost, IReactionSummary, ReactionType } from '../types/news.types';

/** Feed cuộn vô hạn (con trỏ Seq). Bài ghim chỉ có ở trang đầu. */
export const useFeed = (authorId?: string | null, mine?: boolean) =>
  useInfiniteQuery({
    queryKey: newsKeys.feed(authorId, mine),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => newsApi.feed(pageParam, authorId, mine),
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 30_000,
  });

export const usePost = (id: string) => useQuery({ queryKey: newsKeys.post(id), queryFn: () => newsApi.post(id), retry: false });

/** Badge "bài mới" ở sidebar: hỏi lại mỗi 60 giây. */
export const useNewsUnseen = () => {
  const { data } = useQuery({ queryKey: newsKeys.unseen, queryFn: newsApi.unseen, staleTime: 30_000, refetchInterval: 60_000 });
  return data?.count ?? 0;
};

export const useMarkSeen = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: newsApi.markSeen, onSuccess: () => qc.setQueryData(newsKeys.unseen, { count: 0 }) });
};

export const usePeople = (search: string, enabled = true) =>
  useQuery({ queryKey: newsKeys.people(search), queryFn: () => newsApi.people(search), enabled, staleTime: 30_000, placeholderData: (p) => p });

export const useDepartments = () => useQuery({ queryKey: newsKeys.departments, queryFn: newsApi.departments, staleTime: 5 * 60_000 });

/** Sửa một bài trong mọi cache feed + cache bài lẻ (không phải tải lại cả feed). */
export function patchPost(qc: QueryClient, id: string, fn: (p: IPost) => IPost) {
  qc.setQueriesData<InfiniteData<IFeed>>({ queryKey: ['news', 'feed'] }, (d) =>
    d && { ...d, pages: d.pages.map((pg) => ({ ...pg, pinned: pg.pinned.map((p) => (p.id === id ? fn(p) : p)), items: pg.items.map((p) => (p.id === id ? fn(p) : p)) })) });
  qc.setQueryData<IPost>(newsKeys.post(id), (p) => (p ? fn(p) : p));
}

const withSummary = (s: IReactionSummary) => (p: IPost): IPost => ({ ...p, reactionCount: s.total, reactions: s.counts, myReaction: s.mine });

export function useReactPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: ReactionType | null }) => (type ? newsApi.react('posts', id, type) : newsApi.unreact('posts', id)),
    onSuccess: (s, v) => patchPost(qc, v.id, withSummary(s)),
  });
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: newsApi.create, onSuccess: () => qc.invalidateQueries({ queryKey: ['news', 'feed'] }) });
}

export function useEditPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: Parameters<typeof newsApi.edit>[1] }) => newsApi.edit(id, req),
    onSuccess: (p) => patchPost(qc, p.id, () => p),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: newsApi.remove, onSuccess: () => qc.invalidateQueries({ queryKey: ['news'] }) });
}

/** Ẩn / hiện / ghim / bỏ ghim (HR) — tải lại feed vì thứ tự và độ hiển thị đổi. */
export function useModeratePost() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['news'] });
  return {
    hide: useMutation({ mutationFn: (v: { id: string; reason: string }) => newsApi.hide('posts', v.id, v.reason), onSuccess: done }),
    unhide: useMutation({ mutationFn: (id: string) => newsApi.unhide('posts', id), onSuccess: done }),
    pin: useMutation({ mutationFn: (v: { id: string; days: number }) => newsApi.pin(v.id, v.days), onSuccess: done }),
    unpin: useMutation({ mutationFn: (id: string) => newsApi.unpin(id), onSuccess: done }),
  };
}

// ---------------- Bình luận ----------------

export function useComments(postId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: newsKeys.comments(postId),
    enabled,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => newsApi.comments(postId, pageParam),
    // Con trỏ = Seq của bình luận gốc cuối trang
    getNextPageParam: (last) => (last.hasMore ? last.items.filter((c) => !c.parentId).at(-1)?.seq ?? null : null),
    staleTime: 15_000,
  });
}

const bumpCount = (qc: QueryClient, postId: string, d: number) => patchPost(qc, postId, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount + d) }));

export function useAddComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { text: string | null; parentId: string | null; uploadId: string | null }) => newsApi.addComment(postId, v.text, v.parentId, v.uploadId),
    onSuccess: () => { bumpCount(qc, postId, 1); return qc.invalidateQueries({ queryKey: newsKeys.comments(postId) }); },
  });
}

export function useEditComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (v: { id: string; text: string }) => newsApi.editComment(v.id, v.text), onSuccess: () => qc.invalidateQueries({ queryKey: newsKeys.comments(postId) }) });
}

export function useRemoveComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: newsApi.removeComment,
    onSuccess: () => { bumpCount(qc, postId, -1); return qc.invalidateQueries({ queryKey: newsKeys.comments(postId) }); },
  });
}

export function useModerateComment(postId: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: newsKeys.comments(postId) });
  return {
    hide: useMutation({ mutationFn: (v: { id: string; reason: string }) => newsApi.hide('comments', v.id, v.reason), onSuccess: done }),
    unhide: useMutation({ mutationFn: (id: string) => newsApi.unhide('comments', id), onSuccess: done }),
  };
}

export function useReactComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: ReactionType | null }) => (type ? newsApi.react('comments', id, type) : newsApi.unreact('comments', id)),
    onSuccess: (s, v) =>
      qc.setQueryData<InfiniteData<{ items: IComment[]; hasMore: boolean }>>(newsKeys.comments(postId), (d) =>
        d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((c) => (c.id === v.id ? { ...c, reactionCount: s.total, myReaction: s.mine } : c)) })) }),
  });
}

export const useReactors = (kind: 'posts' | 'comments', id: string, enabled: boolean) =>
  useQuery({ queryKey: newsKeys.reactors(kind, id), queryFn: () => newsApi.reactors(kind, id), enabled });
