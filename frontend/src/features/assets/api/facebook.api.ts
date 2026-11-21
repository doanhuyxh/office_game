import { http, httpPost } from '@/services/api-client';
import type { SocialAccountStatus } from '../types/asset.types';
import type { IFacebookAccount, IFacebookAccountDetail, IFacebookAccountRequest } from '../types/facebook.types';
import { base as assetsBase, json } from './asset.api';

/** Facebook Business Manager (chỉ HR) — `/api/assets/social/facebook/accounts` (TEST-207: mỗi nền tảng một tiền tố API). */
const base = `${assetsBase}/social/facebook/accounts`;

/** Key nằm dưới `['assets']` → `useAssetMutation` làm mới luôn. */
export const facebookKeys = {
  accounts: ['assets', 'facebook-accounts'] as const,
  account: (id: string) => ['assets', 'facebook-account', id] as const,
};

export const facebookApi = {
  accounts: () => http<IFacebookAccount[]>(base),
  account: (id: string) => http<IFacebookAccountDetail>(`${base}/${id}`),
  save: (id: string | undefined, body: IFacebookAccountRequest) =>
    id ? http<IFacebookAccountDetail>(`${base}/${id}`, json('PUT', body)) : httpPost<IFacebookAccountDetail>(base, body),
  /** Token chỉ ghi: gửi lên → back-end kiểm tra với Facebook + đồng bộ trang. */
  setToken: (id: string, token: string) => http<IFacebookAccountDetail>(`${base}/${id}/token`, json('PUT', { token })),
  sync: (id: string) => httpPost<IFacebookAccountDetail>(`${base}/${id}/sync`),
  assign: (id: string, employeeId: string, note: string | null) => httpPost<IFacebookAccountDetail>(`${base}/${id}/assign`, { employeeId, note }),
  return: (id: string, note: string | null) => httpPost<IFacebookAccountDetail>(`${base}/${id}/return`, { note }),
  setStatus: (id: string, status: SocialAccountStatus) => httpPost<IFacebookAccountDetail>(`${base}/${id}/status`, { status }),
};
