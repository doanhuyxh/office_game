import { http, httpPost } from '@/services/api-client';
import type {
  IAccessToken, IAccessTokenCreated, IAiConnection, IAiRequest, IAuthorizeInfo, ICreateAccessToken, IGrant,
} from '../types/accessToken.types';

export const accessTokenKeys = {
  all: ['access-tokens'] as const,
  tokens: ['access-tokens', 'tokens'] as const,
  grants: ['access-tokens', 'grants'] as const,
  connections: ['access-tokens', 'connections'] as const,
  activity: (userId?: string | null, all?: boolean) => ['access-tokens', 'activity', all ? 'all' : 'me', userId ?? null] as const,
};

/** Tham số OAuth giữ nguyên tên snake_case khi chuyển cho back-end. */
export type OAuthParams = Record<string, string>;

export const accessTokenApi = {
  list: () => http<IAccessToken[]>('/api/auth/access-tokens'),
  create: (body: ICreateAccessToken) => httpPost<IAccessTokenCreated>('/api/auth/access-tokens', body),
  revoke: (id: string) => http<void>(`/api/auth/access-tokens/${id}`, { method: 'DELETE' }),
  grants: () => http<IGrant[]>('/api/oauth/grants'),
  revokeGrant: (id: string) => http<void>(`/api/oauth/grants/${id}`, { method: 'DELETE' }),
  connections: () => http<IAiConnection[]>('/api/auth/ai-connections'),
  activity: (userId?: string | null, take = 50) =>
    http<IAiRequest[]>(`/api/audit/ai-requests?take=${take}${userId ? `&userId=${userId}` : ''}`),
  authorizeInfo: (p: OAuthParams) => http<IAuthorizeInfo>(`/api/oauth/authorize?${new URLSearchParams(p)}`),
  authorize: (p: OAuthParams, approve: boolean) => httpPost<{ redirectTo: string }>('/api/oauth/authorize', { ...p, approve }),
};
