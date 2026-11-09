import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { socialApi, socialKeys } from '../api/social.api';
import type { IPaged } from '@/types/api';
import type { ISocialPost } from '../types/social.types';

/** Trang được đăng. `quiet`: dùng cả cho menu (lỗi không hiện toast). */
export const useSocialPages = (enabled = true) =>
  useQuery({ queryKey: socialKeys.pages, queryFn: socialApi.pages, enabled, staleTime: 60_000, retry: false, meta: { quiet: true } });

/** Còn đích đang đăng / sắp tới giờ → làm mới mỗi 4 giây để thấy kết quả. */
const busy = (page: IPaged<ISocialPost> | undefined) => {
  const soon = Date.now() + 60_000;
  return !!page?.items.some((p) => p.targets.some((t) => t.status === 'Publishing' || (t.status === 'Pending' && Date.parse(t.dueAt) <= soon)));
};

export const useSocialPosts = (q: IPageQuery) =>
  useQuery({
    queryKey: socialKeys.posts(q), queryFn: () => socialApi.posts(q), placeholderData: (prev) => prev,
    refetchInterval: (query) => (busy(query.state.data) ? 4_000 : 60_000),
  });

export const useMediaUrl = (id: string) =>
  useQuery({ queryKey: socialKeys.mediaUrl(id), queryFn: () => socialApi.mediaUrl(id), staleTime: 8 * 60_000, retry: false, meta: { quiet: true } });

export function useSocialMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: socialKeys.all }) });
}
