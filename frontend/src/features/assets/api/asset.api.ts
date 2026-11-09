import { http, httpPost, httpUpload, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  AttachmentKind, DeviceStatus, IAssetSettings, ICategory, IDeviceAttachment, IHandover, ITemplateField, ICategoryRequest, IDevice, IDeviceDetail, IDeviceFilter, IDeviceRequest, IGrantSeatRequest, IHoldings, IOverview,
  IReview, IReviewDetail, IReviewItem, ISeat, IService, IServiceRequest, IStocktake, IStocktakeDetail, IStocktakeItem, ReviewDecision, StocktakeResult,
  ISocialAccount, ISocialAccountDetail, ISocialAccountRequest, SocialAccountStatus,
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
  attachments: (deviceId: string) => ['assets', 'attachments', deviceId] as const,
  myHandovers: ['assets', 'handovers', 'my'] as const,
  handovers: (unconfirmed: boolean) => ['assets', 'handovers', unconfirmed] as const,
  settings: ['assets', 'settings'] as const,
  templateFields: ['assets', 'template-fields'] as const,
  socialAccounts: ['assets', 'social-accounts'] as const,
  socialAccount: (id: string) => ['assets', 'social-account', id] as const,
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

  attachments: (deviceId: string) => http<IDeviceAttachment[]>(`${base}/devices/${deviceId}/attachments`),
  attachmentUrl: (id: string, download: boolean) => http<{ url: string }>(`${base}/attachments/${id}/url${download ? '?download=true' : ''}`),
  deleteAttachment: (id: string) => http<void>(`${base}/attachments/${id}`, { method: 'DELETE' }),
  /** Xin link → trình duyệt PUT thẳng lên S3 (đúng Content-Type) → xác nhận. */
  uploadAttachment: async (deviceId: string, kind: AttachmentKind, file: File) => {
    const t = await httpPost<{ id: string; uploadUrl: string; contentType: string }>(`${base}/devices/${deviceId}/attachments`,
      { kind, fileName: file.name, contentType: file.type || null, size: file.size });
    const put = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: file });
    if (!put.ok) throw new Error(`Tải "${file.name}" lên kho thất bại (${put.status})`);
    return httpPost<IDeviceAttachment>(`${base}/attachments/${t.id}/confirm`, {});
  },

  myHandovers: () => http<IHandover[]>(`${base}/handovers/my`),
  handovers: (unconfirmed: boolean) => http<IHandover[]>(`${base}/handovers${unconfirmed ? '?unconfirmed=true' : ''}`),
  confirmHandover: (id: string) => httpPost<IHandover>(`${base}/handovers/${id}/confirm`),
  /** File Word biên bản (GET, cookie cùng origin) — dùng với `downloadUrl`. */
  handoverDocxUrl: (id: string) => `${base}/handovers/${id}/docx`,

  settings: () => http<IAssetSettings>(`${base}/settings`),
  templateFields: () => http<ITemplateField[]>(`${base}/settings/handover-template/fields`),
  defaultTemplateUrl: `${base}/settings/handover-template/default`,
  uploadTemplate: (file: File) => httpUpload<void>(`${base}/settings/handover-template`, file),
  deleteTemplate: () => http<void>(`${base}/settings/handover-template`, { method: 'DELETE' }),

  socialAccounts: () => http<ISocialAccount[]>(`${base}/social/accounts`),
  socialAccount: (id: string) => http<ISocialAccountDetail>(`${base}/social/accounts/${id}`),
  saveSocialAccount: (id: string | undefined, body: ISocialAccountRequest) =>
    id ? http<ISocialAccountDetail>(`${base}/social/accounts/${id}`, json('PUT', body)) : httpPost<ISocialAccountDetail>(`${base}/social/accounts`, body),
  /** Token chỉ ghi: gửi lên → back-end kiểm tra với Facebook + đồng bộ trang. */
  setSocialToken: (id: string, token: string) => http<ISocialAccountDetail>(`${base}/social/accounts/${id}/token`, json('PUT', { token })),
  syncSocial: (id: string) => httpPost<ISocialAccountDetail>(`${base}/social/accounts/${id}/sync`),
  assignSocial: (id: string, employeeId: string, note: string | null) => httpPost<ISocialAccountDetail>(`${base}/social/accounts/${id}/assign`, { employeeId, note }),
  returnSocial: (id: string, note: string | null) => httpPost<ISocialAccountDetail>(`${base}/social/accounts/${id}/return`, { note }),
  setSocialStatus: (id: string, status: SocialAccountStatus) => httpPost<ISocialAccountDetail>(`${base}/social/accounts/${id}/status`, { status }),
};
