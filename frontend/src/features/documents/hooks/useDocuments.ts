import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { documentApi, documentKeys } from '../api/document.api';
import type { IAssetFilter, ISpaceRef } from '../types/document.types';

const keep = { placeholderData: <T,>(prev: T) => prev };

export const useSpaces = () => useQuery({ queryKey: documentKeys.spaces, queryFn: documentApi.spaces });
export const useFolders = (s: ISpaceRef | null) =>
  useQuery({ queryKey: documentKeys.folders(s ?? { kind: 'Company', id: null }), queryFn: () => documentApi.folders(s!), enabled: !!s });
export const useDocTypes = () => useQuery({ queryKey: documentKeys.docTypes, queryFn: documentApi.docTypes, staleTime: 5 * 60_000 });
export const useAssets = (f: IAssetFilter, q: IPageQuery, enabled = true) =>
  useQuery({ queryKey: documentKeys.assets(f, q), queryFn: () => documentApi.assets(f, q), enabled, ...keep });
export const useAsset = (id: string | null) =>
  useQuery({ queryKey: documentKeys.asset(id ?? ''), queryFn: () => documentApi.asset(id!), enabled: !!id, retry: false });
export const useApprovers = (id: string, status: string, enabled: boolean) =>
  useQuery({ queryKey: documentKeys.approvers(id, status), queryFn: () => documentApi.approvers(id), enabled });
export const useAccessLog = (id: string, q: IPageQuery, enabled: boolean) =>
  useQuery({ queryKey: documentKeys.accessLog(id, q), queryFn: () => documentApi.accessLog(id, q), enabled, ...keep });
export const useTrash = (q: IPageQuery) => useQuery({ queryKey: documentKeys.trash(q), queryFn: () => documentApi.trash(q), ...keep });
export const useRecentPublished = (enabled = true) => useQuery({ queryKey: documentKeys.recent, queryFn: documentApi.recent, enabled });
export const useDocStats = () => useQuery({ queryKey: documentKeys.stats, queryFn: documentApi.stats });
export const useRetentionDue = (q: IPageQuery) => useQuery({ queryKey: documentKeys.retention(q), queryFn: () => documentApi.retention(q), ...keep });
export const useOrphans = () => useQuery({ queryKey: documentKeys.orphans, queryFn: documentApi.orphans });

/** Mọi thao tác ghi làm mới toàn bộ cache kho tài liệu (dữ liệu nhỏ, đơn giản hơn chọn từng key). */
export function useDocMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: documentKeys.all }) });
}
