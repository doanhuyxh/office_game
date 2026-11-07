import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  DeviceStatus, ICategory, ICategoryRequest, IDevice, IDeviceDetail, IDeviceFilter, IDeviceRequest, IGrantSeatRequest, IHoldings, IOverview,
  IReview, IReviewDetail, IReviewItem, ISeat, IService, IServiceRequest, IStocktake, IStocktakeDetail, IStocktakeItem, ReviewDecision, StocktakeResult,
} from '../types/asset.types';

const base = '/api/assets';
const json = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const assetKeys = {
  all: ['assets'] as const,
  categories: ['assets', 'categories'] as const,
  devices: (f: IDeviceFilter, q: IPageQuery) => ['assets', 'devices', f, q] as const,
  device: (id: string) => ['assets', 'device', id] as const,
  services: ['assets', 'services'] as const,
  seats: (id: string) => ['assets', 'seats', id] as const,
  my: ['assets', 'my'] as const,
  holdings: (employeeId: string) => ['assets', 'holdings', employeeId] as const,
  overview: ['assets', 'overview'] as const,
  reviews: ['assets', 'reviews'] as const,
  review: (id: string) => ['assets', 'review', id] as const,
  pending: ['assets', 'reviews', 'pending'] as const,
  stocktakes: ['assets', 'stocktakes'] as const,
  stocktake: (id: string) => ['assets', 'stocktake', id] as const,
};

/** Link tải Excel (GET, cookie cùng origin) — dùng với `downloadUrl` (@/utils/money). */
export const assetExcelUrl = { devices: `${base}/export/devices`, services: `${base}/export/services` };

export const assetApi = {
  categories: () => http<ICategory[]>(`${base}/categories`),
  saveCategory: (id: string | undefined, body: ICategoryRequest) =>
    id ? http<ICategory>(`${base}/categories/${id}`, json('PUT', body)) : httpPost<ICategory>(`${base}/categories`, body),

  devices: (f: IDeviceFilter, q: IPageQuery) => {
    const qs = new URLSearchParams();
    if (f.search?.trim()) qs.set('search', f.search.trim());
    if (f.categoryId) qs.set('categoryId', f.categoryId);
    if (f.status) qs.set('status', f.status);
    if (f.holderId) qs.set('holderId', f.holderId);
    return http<IPaged<IDevice>>(`${base}/devices?${qs}&${pageQs(q)}`);
  },
  device: (id: string) => http<IDeviceDetail>(`${base}/devices/${id}`),
  saveDevice: (id: string | undefined, body: IDeviceRequest) =>
    id ? http<IDevice>(`${base}/devices/${id}`, json('PUT', body)) : httpPost<IDevice>(`${base}/devices`, body),
  deleteDevice: (id: string) => http<void>(`${base}/devices/${id}`, { method: 'DELETE' }),
  assign: (id: string, employeeId: string, note: string | null) => httpPost<IDeviceDetail>(`${base}/devices/${id}/assign`, { employeeId, note }),
  returnDevice: (id: string, note: string | null) => httpPost<IDeviceDetail>(`${base}/devices/${id}/return`, { note }),
  setStatus: (id: string, status: DeviceStatus, reason: string | null) => httpPost<IDeviceDetail>(`${base}/devices/${id}/status`, { status, reason }),

  services: () => http<IService[]>(`${base}/services`),
  saveService: (id: string | undefined, body: IServiceRequest) =>
    id ? http<IService>(`${base}/services/${id}`, json('PUT', body)) : httpPost<IService>(`${base}/services`, body),
  cancelService: (id: string) => httpPost<IService>(`${base}/services/${id}/cancel`),
  seats: (id: string) => http<ISeat[]>(`${base}/services/${id}/seats?includeRevoked=true`),
  grantSeat: (id: string, body: IGrantSeatRequest) => httpPost<ISeat>(`${base}/services/${id}/seats`, body),
  revokeSeat: (id: string) => httpPost<ISeat>(`${base}/seats/${id}/revoke`),

  my: () => http<IHoldings>(`${base}/my`),
  holdings: (employeeId: string) => http<IHoldings>(`${base}/employees/${employeeId}/holdings`),
  overview: () => http<IOverview>(`${base}/overview`),

  reviews: () => http<IReview[]>(`${base}/reviews`),
  review: (id: string) => http<IReviewDetail>(`${base}/reviews/${id}`),
  pending: () => http<IReviewItem[]>(`${base}/reviews/pending`),
  startReview: (body: { title: string; dueDate: string; serviceId: string | null }) => httpPost<IReview>(`${base}/reviews`, body),
  decide: (itemId: string, decision: ReviewDecision, note: string | null) => httpPost<IReviewItem>(`${base}/reviews/items/${itemId}/decide`, { decision, note }),
  closeReview: (id: string) => httpPost<IReview>(`${base}/reviews/${id}/close`),

  stocktakes: () => http<IStocktake[]>(`${base}/stocktakes`),
  stocktake: (id: string) => http<IStocktakeDetail>(`${base}/stocktakes/${id}`),
  startStocktake: (title: string) => httpPost<IStocktake>(`${base}/stocktakes`, { title }),
  checkItem: (itemId: string, result: StocktakeResult, note: string | null) => httpPost<IStocktakeItem>(`${base}/stocktakes/items/${itemId}/check`, { result, note }),
  closeStocktake: (id: string, markMissingAsLost: boolean) => httpPost<IStocktake>(`${base}/stocktakes/${id}/close`, { markMissingAsLost }),
};
