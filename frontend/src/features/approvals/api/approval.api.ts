import { http, httpPost } from '@/services/api-client';
import type { IApproval, ICreateDelegation, IDelegation, IMyDelegations } from '../types/approval.types';

export const approvalKeys = {
  all: ['approval'] as const,
  inbox: ['approval', 'inbox'] as const,
  inboxCount: ['approval', 'inbox', 'count'] as const,
  mine: ['approval', 'mine'] as const,
  delegations: ['approval', 'delegations'] as const,
  myDelegations: ['approval', 'delegations', 'my'] as const,
  allDelegations: (status: 'current' | 'all') => ['approval', 'delegations', 'all', status] as const,
};

export const approvalApi = {
  inbox: () => http<IApproval[]>('/api/approval/inbox'),
  inboxCount: () => http<{ count: number }>('/api/approval/inbox/count'),
  mine: () => http<IApproval[]>('/api/approval/mine'),
  approve: (id: string, comment?: string) => httpPost<IApproval>(`/api/approval/${id}/approve`, { comment: comment || null }),
  reject: (id: string, comment: string) => httpPost<IApproval>(`/api/approval/${id}/reject`, { comment }),
  cancel: (id: string) => httpPost<IApproval>(`/api/approval/${id}/cancel`),
  myDelegations: () => http<IMyDelegations>('/api/approval/delegations'),
  /** HR: mọi uỷ quyền — current = đang / sắp hiệu lực. */
  allDelegations: (status: 'current' | 'all') => http<IDelegation[]>(`/api/approval/delegations/all?status=${status}`),
  createDelegation: (body: ICreateDelegation) => httpPost<IDelegation>('/api/approval/delegations', body),
  revokeDelegation: (id: string) => httpPost<IDelegation>(`/api/approval/delegations/${id}/revoke`),
};
