import { http, httpPost } from '@/services/api-client';
import type { IApproval } from '../types/approval.types';

export const approvalKeys = {
  all: ['approval'] as const,
  inbox: ['approval', 'inbox'] as const,
  inboxCount: ['approval', 'inbox', 'count'] as const,
  mine: ['approval', 'mine'] as const,
};

export const approvalApi = {
  inbox: () => http<IApproval[]>('/api/approval/inbox'),
  inboxCount: () => http<{ count: number }>('/api/approval/inbox/count'),
  mine: () => http<IApproval[]>('/api/approval/mine'),
  approve: (id: string, comment?: string) => httpPost<IApproval>(`/api/approval/${id}/approve`, { comment: comment || null }),
  reject: (id: string, comment: string) => httpPost<IApproval>(`/api/approval/${id}/reject`, { comment }),
  cancel: (id: string) => httpPost<IApproval>(`/api/approval/${id}/cancel`),
};
