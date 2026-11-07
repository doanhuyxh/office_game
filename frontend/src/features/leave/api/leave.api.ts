import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type { IAdjustment, IBalance, ICreateLeave, IEmployeeBalance, ILeaveRequest, ILeaveType, IPreview, LeavePeriod } from '../types/leave.types';

export const leaveKeys = {
  all: ['leave'] as const,
  types: ['leave', 'types'] as const,
  balance: ['leave', 'balance'] as const,
  myPage: (q: IPageQuery) => ['leave', 'my', 'page', q] as const,
  teamPage: (from: string, to: string, q: IPageQuery) => ['leave', 'team', from, to, q] as const,
  balancesPage: (q: IPageQuery) => ['leave', 'balances', 'page', q] as const,
  preview: (start: string, end: string, period: LeavePeriod) => ['leave', 'preview', start, end, period] as const,
  adjustments: (employeeId?: string) => ['leave', 'adjustments', employeeId ?? 'all'] as const,
};

export const leaveApi = {
  types: () => http<ILeaveType[]>('/api/leave/types'),
  balance: () => http<IBalance>('/api/leave/balance'),
  balancesPage: (q: IPageQuery) => http<IPaged<IEmployeeBalance>>(`/api/leave/balances?${pageQs(q)}`),
  preview: (start: string, end: string, period: LeavePeriod) =>
    http<IPreview>(`/api/leave/preview?startDate=${start}&endDate=${end}&period=${period}`),
  create: (body: ICreateLeave) => httpPost<ILeaveRequest>('/api/leave/requests', body),
  myPage: (q: IPageQuery) => http<IPaged<ILeaveRequest>>(`/api/leave/requests/my?${pageQs(q)}`),
  teamPage: (from: string, to: string, q: IPageQuery) => http<IPaged<ILeaveRequest>>(`/api/leave/requests?from=${from}&to=${to}&${pageQs(q)}`),
  adjustments: (employeeId?: string) => http<IAdjustment[]>(`/api/leave/adjustments${employeeId ? `?employeeId=${employeeId}` : ''}`),
  adjust: (employeeId: string, days: number, reason: string) => httpPost<IAdjustment>('/api/leave/adjustments', { employeeId, days, reason }),
};
