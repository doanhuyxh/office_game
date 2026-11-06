import { http, httpPost } from '@/services/api-client';
import type { IAccessToken, IAccessTokenCreated, ICreateAccessToken } from '../types/accessToken.types';

export const accessTokenKeys = {
  all: ['access-tokens'] as const,
};

export const accessTokenApi = {
  list: () => http<IAccessToken[]>('/api/auth/access-tokens'),
  create: (body: ICreateAccessToken) => httpPost<IAccessTokenCreated>('/api/auth/access-tokens', body),
  revoke: (id: string) => http<void>(`/api/auth/access-tokens/${id}`, { method: 'DELETE' }),
};
