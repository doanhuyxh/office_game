import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  IAccessToken, IAccessTokenCreated, IAiConnection, IAiRequest, IAuthorizeInfo, ICreateAccessToken, IGrant,
} from '../types/accessToken.types';

export const accessTokenKeys = {
  all: ['access-tokens'] as const,
  tokens: ['access-tokens', 'tokens'] as const,
  grants: ['access-tokens', 'grants'] as const,
  connectionsPage: (q: IPageQuery) => ['access-tokens', 'connections', 'page', q] as const,
  activityPage: (userId: string | null | undefined, all: boolean | undefined, q: IPageQuery) =>
    ['access-tokens', 'activity', all ? 'all' : 'me', userId ?? null, q] as const,
};

/** Tham số OAuth giữ nguyên tên snake_case khi chuyển cho back-end. */
export type OAuthParams = Record<string, string>;

export const accessTokenApi = {
  list: () => http<IAccessToken[]>('/api/auth/access-tokens'),
  create: (body: ICreateAccessToken) => httpPost<IAccessTokenCreated>('/api/auth/access-tokens', body),
  revoke: (id: string) => http<void>(`/api/auth/access-tokens/${id}`, { method: 'DELETE' }),
  grants: () => http<IGrant[]>('/api/oauth/grants'),
  revokeGrant: (id: string) => http<void>(`/api/oauth/grants/${id}`, { method: 'DELETE' }),
  connectionsPage: (q: IPageQuery) => http<IPaged<IAiConnection>>(`/api/auth/ai-connections?${pageQs(q)}`),
  activityPage: (userId: string | null | undefined, q: IPageQuery) =>
    http<IPaged<IAiRequest>>(`/api/audit/ai-requests?${pageQs(q)}${userId ? `&userId=${userId}` : ''}`),
  authorizeInfo: (p: OAuthParams) => http<IAuthorizeInfo>(`/api/oauth/authorize?${new URLSearchParams(p)}`),
  authorize: (p: OAuthParams, approve: boolean) => httpPost<{ redirectTo: string }>('/api/oauth/authorize', { ...p, approve }),
};
