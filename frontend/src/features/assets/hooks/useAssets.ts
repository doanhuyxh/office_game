import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { assetApi, assetKeys } from '../api/asset.api';
import type { IDeviceFilter } from '../types/asset.types';

export const useCategories = () => useQuery({ queryKey: assetKeys.categories, queryFn: assetApi.categories, staleTime: 5 * 60_000 });
export const useDevices = (f: IDeviceFilter, q: IPageQuery, enabled = true) =>
  useQuery({ queryKey: assetKeys.devices(f, q), queryFn: () => assetApi.devices(f, q), enabled, placeholderData: (prev) => prev });
export const useDevice = (id: string | null) =>
  useQuery({ queryKey: assetKeys.device(id ?? ''), queryFn: () => assetApi.device(id!), enabled: !!id, retry: false });
export const useServices = (enabled = true) => useQuery({ queryKey: assetKeys.services, queryFn: assetApi.services, enabled });
export const useSeats = (serviceId: string | null) =>
  useQuery({ queryKey: assetKeys.seats(serviceId ?? ''), queryFn: () => assetApi.seats(serviceId!), enabled: !!serviceId });
export const useMyAssets = () => useQuery({ queryKey: assetKeys.my, queryFn: assetApi.my });
/** `quiet`: 403 (không đủ quyền xem) không retry — dùng cho khối hiển thị phụ (hộp thoại nhân viên, cảnh báo nghỉ việc). */
export const useHoldings = (employeeId: string | null) =>
  useQuery({ queryKey: assetKeys.holdings(employeeId ?? ''), queryFn: () => assetApi.holdings(employeeId!), enabled: !!employeeId, retry: false, meta: { quiet: true } });
export const useOverview = (enabled = true) => useQuery({ queryKey: assetKeys.overview, queryFn: assetApi.overview, enabled });
export const useReviews = (enabled = true) => useQuery({ queryKey: assetKeys.reviews, queryFn: assetApi.reviews, enabled });
export const useReview = (id: string | null) =>
  useQuery({ queryKey: assetKeys.review(id ?? ''), queryFn: () => assetApi.review(id!), enabled: !!id });
export const usePendingReviews = () => useQuery({ queryKey: assetKeys.pending, queryFn: assetApi.pending, retry: false });
export const useStocktakes = (enabled = true) => useQuery({ queryKey: assetKeys.stocktakes, queryFn: assetApi.stocktakes, enabled });
export const useStocktake = (id: string | null) =>
  useQuery({ queryKey: assetKeys.stocktake(id ?? ''), queryFn: () => assetApi.stocktake(id!), enabled: !!id });

/** Mọi thao tác ghi làm mới toàn bộ cache tài sản (dữ liệu nhỏ, đơn giản hơn chọn từng key). */
export function useAssetMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: assetKeys.all }) });
}
