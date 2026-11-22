import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { facebookApi, facebookKeys } from '../api/facebook.api';
import type { IPaged } from '@/types/api';
import type { IFacebookPost } from '../types/facebook.types';

/** Trang được đăng. `quiet`: dùng cả cho menu (lỗi không hiện toast). */
export const useFacebookPages = (enabled = true) =>
  useQuery({ queryKey: facebookKeys.pages, queryFn: facebookApi.pages, enabled, staleTime: 60_000, retry: false, meta: { quiet: true } });

/** Còn đích đang đăng / sắp tới giờ → làm mới mỗi 4 giây để thấy kết quả. */
const busy = (page: IPaged<IFacebookPost> | undefined) => {
  const soon = Date.now() + 60_000;
  return !!page?.items.some((p) => p.targets.some((t) => t.status === 'Publishing' || (t.status === 'Pending' && Date.parse(t.dueAt) <= soon)));
};

export const useFacebookPosts = (q: IPageQuery) =>
  useQuery({
    queryKey: facebookKeys.posts(q), queryFn: () => facebookApi.posts(q), placeholderData: (prev) => prev,
    refetchInterval: (query) => (busy(query.state.data) ? 4_000 : 60_000),
  });

export const useFacebookMediaUrl = (id: string) =>
  useQuery({ queryKey: facebookKeys.mediaUrl(id), queryFn: () => facebookApi.mediaUrl(id), staleTime: 8 * 60_000, retry: false, meta: { quiet: true } });

/** Chi tiết Fanpage; đang đồng bộ (job / người khác bấm) → hỏi lại mỗi 3 giây. */
export const useFacebookPageDetail = (id: string) =>
  useQuery({ queryKey: facebookKeys.page(id), queryFn: () => facebookApi.page(id), retry: false,
    refetchInterval: (query) => (query.state.data?.postsSyncing ? 3_000 : false) });

export const useFacebookPagePosts = (id: string, q: IPageQuery) =>
  useQuery({ queryKey: facebookKeys.pagePosts(id, q), queryFn: () => facebookApi.pagePosts(id, q), placeholderData: (prev) => prev });

export function useFacebookMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: facebookKeys.all }) });
}
