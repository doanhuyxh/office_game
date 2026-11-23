import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { wikiApi, wikiKeys } from '../api/wiki.api';
import { projectKeys } from '../api/project.api';

/** Cây trang sổ tay (không nội dung) + cờ quyền. */
export const useWikiTree = (projectId: string, enabled = true) =>
  useQuery({ queryKey: wikiKeys.tree(projectId), queryFn: () => wikiApi.tree(projectId), enabled });
/** Một trang đầy đủ. */
export const useWikiPage = (projectId: string, pageId: string | null) =>
  useQuery({ queryKey: wikiKeys.page(projectId, pageId ?? ''), queryFn: () => wikiApi.page(projectId, pageId!), enabled: !!pageId, retry: false });
/** Tìm trong tiêu đề + tóm tắt + nội dung (≤ 20 kết quả kèm đoạn trích); `q` rỗng → không gọi. */
export const useWikiSearch = (projectId: string, q: string) =>
  useQuery({ queryKey: wikiKeys.search(projectId, q), queryFn: () => wikiApi.search(projectId, q), enabled: q.length > 0 });
/** Lịch sử phiên bản (mới nhất trước, không nội dung). */
export const useWikiVersions = (projectId: string, pageId: string, page: number, pageSize: number, enabled: boolean) =>
  useQuery({ queryKey: wikiKeys.versions(projectId, pageId, page), queryFn: () => wikiApi.versions(projectId, pageId, page, pageSize), enabled });
/** Một phiên bản đủ nội dung. */
export const useWikiVersion = (projectId: string, pageId: string, n: number | null) =>
  useQuery({ queryKey: wikiKeys.version(projectId, pageId, n ?? 0), queryFn: () => wikiApi.version(projectId, pageId, n!), enabled: n != null });

/** Ghi sổ tay → làm mới mọi query sổ tay của dự án + chi tiết dự án (số trang ở tab Tổng quan). */
export function useWikiMutation<A, R>(projectId: string, fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: wikiKeys.all(projectId) });
      void qc.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}
