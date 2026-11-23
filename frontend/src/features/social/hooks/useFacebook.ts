import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { facebookApi, facebookKeys } from '../api/facebook.api';
import type { IPaged } from '@/types/api';
import type { IFacebookComment, IFacebookCommentList, IFacebookPost } from '../types/facebook.types';

/** Trang được đăng. `quiet`: dùng cả cho menu (lỗi không hiện toast). */
export const useFacebookPages = (enabled = true) =>
  useQuery({ queryKey: facebookKeys.pages, queryFn: facebookApi.pages, enabled, staleTime: 60_000, retry: false, meta: { quiet: true } });

/** Còn đích đang đăng / sắp tới giờ → làm mới mỗi 4 giây để thấy kết quả. */
const busy = (page: IPaged<IFacebookPost> | undefined) => {
  const soon = Date.now() + 60_000;
  return !!page?.items.some((p) => p.targets.some((t) => t.status === 'Publishing' || (t.status === 'Pending' && Date.parse(t.dueAt) <= soon)));
};

export const useFacebookPosts = (q: IPageQuery, deleted = false) =>
  useQuery({
    queryKey: facebookKeys.posts(q, deleted), queryFn: () => facebookApi.posts(q, deleted), placeholderData: (prev) => prev,
    refetchInterval: (query) => (busy(query.state.data) ? 4_000 : 60_000),
  });

/** Số bài đã xoá (TEST-214) — chỉ gọi khi là HR / Quản trị viên. */
export const useFacebookPostCounts = (enabled: boolean) =>
  useQuery({ queryKey: facebookKeys.postCounts, queryFn: facebookApi.postCounts, enabled, retry: false, meta: { quiet: true } });

export const useFacebookMediaUrl = (id: string) =>
  useQuery({ queryKey: facebookKeys.mediaUrl(id), queryFn: () => facebookApi.mediaUrl(id), staleTime: 8 * 60_000, retry: false, meta: { quiet: true } });

/** Chi tiết Fanpage; đang đồng bộ (job / người khác bấm) → hỏi lại mỗi 3 giây. */
export const useFacebookPageDetail = (id: string) =>
  useQuery({ queryKey: facebookKeys.page(id), queryFn: () => facebookApi.page(id), retry: false,
    refetchInterval: (query) => (query.state.data?.postsSyncing ? 3_000 : false) });

export const useFacebookPagePosts = (id: string, q: IPageQuery, deleted = false) =>
  useQuery({ queryKey: facebookKeys.pagePosts(id, q, deleted), queryFn: () => facebookApi.pagePosts(id, q, deleted), placeholderData: (prev) => prev });

export function useFacebookMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: facebookKeys.all }) });
}

/** Bình luận cấp 1 của bài (TEST-212): cuộn "Xem thêm" bằng cursor `after` của Facebook. Chỉ tải khi mở khung bình luận. */
export const useFacebookComments = (pageId: string, postId: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: facebookKeys.comments(pageId, postId), enabled, retry: false, staleTime: 30_000, meta: { quiet: true },
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => facebookApi.comments(pageId, postId, pageParam),
    getNextPageParam: (last) => last.after,
  });

/** Trả lời của một bình luận — chỉ tải khi bấm "Xem N trả lời". */
export const useFacebookReplies = (pageId: string, postId: string, commentId: string, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: facebookKeys.replies(pageId, postId, commentId), enabled, retry: false, staleTime: 30_000, meta: { quiet: true },
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => facebookApi.replies(pageId, postId, commentId, pageParam),
    getNextPageParam: (last) => last.after,
  });

type CommentPages = InfiniteData<IFacebookCommentList, string | null>;

/**
 * Gửi trả lời bình luận dưới tên Trang. Xong: thêm trả lời vào cuối danh sách trả lời đã tải (bỏ qua nếu đã có — lần bấm trùng server trả lại
 * trả lời cũ), tăng số trả lời của bình luận cha (trừ lần bấm trùng); danh sách trả lời chưa tải thì để lần mở sau lấy từ Facebook.
 */
export function useFacebookReply(pageId: string, postId: string, commentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => facebookApi.reply(pageId, postId, commentId, message),
    onSuccess: ({ reply, duplicate }) => {
      qc.setQueryData<CommentPages>(facebookKeys.replies(pageId, postId, commentId), (old) => {
        if (!old || old.pages.some((p) => p.items.some((c) => c.id === reply.id))) return old;
        const pages = [...old.pages];
        const last = pages[pages.length - 1];
        pages[pages.length - 1] = { ...last, items: [...last.items, reply] };
        return { ...old, pages };
      });
      if (duplicate) return; // lần bấm trùng: trả lời đã tính rồi
      qc.setQueryData<CommentPages>(facebookKeys.comments(pageId, postId), (old) => old && {
        ...old,
        pages: old.pages.map((p) => ({
          ...p, items: p.items.map((c: IFacebookComment) => (c.id === commentId ? { ...c, replyCount: c.replyCount + 1 } : c)),
        })),
      });
    },
  });
}
