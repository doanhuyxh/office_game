import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { wikiShareApi, wikiShareKeys } from '../api/wiki-share.api';

/** Link chia sẻ của một trang (mới nhất trước) — chỉ quản lý dự án / HR gọi được. */
export const useWikiShares = (projectId: string, pageId: string, enabled: boolean) =>
  useQuery({ queryKey: wikiShareKeys.list(projectId, pageId), queryFn: () => wikiShareApi.list(projectId, pageId), enabled });

/** Nhật ký mở một link (phân trang ở server). */
export const useWikiShareViews = (projectId: string, shareId: string | null, page: number, pageSize: number) =>
  useQuery({ queryKey: wikiShareKeys.views(projectId, shareId ?? '', page), queryFn: () => wikiShareApi.views(projectId, shareId!, page, pageSize), enabled: !!shareId });

/** Tạo / thu hồi link → làm mới danh sách link của dự án. */
export function useWikiShareMutation<A, R>(projectId: string, fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: wikiShareKeys.all(projectId) }) });
}
