import { http, httpPost } from '@/services/api-client';
import type { IContact, IMyProfile, IProfileRequest, ISensitive, ISensitiveChange } from '../types/profile.types';

const put = <T>(url: string, body: unknown) => http<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const base = '/api/org/profile';

export const profileKeys = {
  all: ['profile'] as const,
  me: ['profile', 'me'] as const,
  requests: (status?: string) => ['profile', 'requests', status ?? 'Pending'] as const,
  employee: (id: string) => ['profile', 'employee', id] as const,
};

/** Thông tin cá nhân — /api/org/profile nằm ngoài allowlist token AI (CCCD / ngân hàng không ra MCP). */
export const profileApi = {
  me: () => http<IMyProfile>(`${base}/me`),
  saveContact: (c: IContact) => put<IMyProfile>(`${base}/me/contact`, c),
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return http<string>(`${base}/me/avatar`, { method: 'POST', body: form });
  },
  deleteAvatar: () => http<void>(`${base}/me/avatar`, { method: 'DELETE' }),
  submit: (change: ISensitiveChange, note: string | null) => httpPost<IProfileRequest>(`${base}/me/requests`, { change, note }),
  cancel: (id: string) => http<void>(`${base}/me/requests/${id}`, { method: 'DELETE' }),
  // HR
  requests: (status?: string) => http<IProfileRequest[]>(`${base}/requests${status ? `?status=${status}` : ''}`),
  approve: (id: string) => httpPost<IProfileRequest>(`${base}/requests/${id}/approve`),
  reject: (id: string, reason: string) => httpPost<void>(`${base}/requests/${id}/reject`, { reason }),
  employee: (id: string) => http<IMyProfile>(`${base}/employees/${id}`),
  saveEmployee: (id: string, contact: IContact, sensitive: ISensitive) => put<IMyProfile>(`${base}/employees/${id}`, { contact, sensitive }),
};
