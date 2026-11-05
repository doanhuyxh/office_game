import { http, httpPost } from '@/services/api-client';
import type { IAdjustment, IBalance, ICreateLeave, IEmployeeBalance, ILeaveRequest, ILeaveType, IPreview, LeavePeriod } from '../types/leave.types';

export const leaveKeys = {
  all: ['leave'] as const,
  types: ['leave', 'types'] as const,
  balance: ['leave', 'balance'] as const,
  balances: ['leave', 'balances'] as const,
  my: ['leave', 'my'] as const,
  team: (from: string, to: string) => ['leave', 'team', from, to] as const,
  preview: (start: string, end: string, period: LeavePeriod) => ['leave', 'preview', start, end, period] as const,
  adjustments: (employeeId?: string) => ['leave', 'adjustments', employeeId ?? 'all'] as const,
};

export const leaveApi = {
  types: () => http<ILeaveType[]>('/api/leave/types'),
  balance: () => http<IBalance>('/api/leave/balance'),
  balances: () => http<IEmployeeBalance[]>('/api/leave/balances'),
  preview: (start: string, end: string, period: LeavePeriod) =>
    http<IPreview>(`/api/leave/preview?startDate=${start}&endDate=${end}&period=${period}`),
  create: (body: ICreateLeave) => httpPost<ILeaveRequest>('/api/leave/requests', body),
  my: () => http<ILeaveRequest[]>('/api/leave/requests/my'),
  team: (from: string, to: string) => http<ILeaveRequest[]>(`/api/leave/requests?from=${from}&to=${to}`),
  adjustments: (employeeId?: string) => http<IAdjustment[]>(`/api/leave/adjustments${employeeId ? `?employeeId=${employeeId}` : ''}`),
  adjust: (employeeId: string, days: number, reason: string) => httpPost<IAdjustment>('/api/leave/adjustments', { employeeId, days, reason }),
};
