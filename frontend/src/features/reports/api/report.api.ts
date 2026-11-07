import { http, pageQs } from '@/services/api-client';
import type { IPageQuery } from '@/types/api';
import type { ILeavePayoutPage, ILeavePayoutRow, IOvertimePayPage } from '../types/report.types';

export const reportKeys = {
  all: ['reports'] as const,
  overtimePayPage: (month: string, q: IPageQuery) => ['reports', 'overtime-pay', month, q] as const,
  leavePayoutPage: (q: IPageQuery) => ['reports', 'leave-payout', 'page', q] as const,
  myLeavePayout: ['reports', 'leave-payout', 'me'] as const,
};

export const reportApi = {
  overtimePayPage: (month: string, q: IPageQuery) => http<IOvertimePayPage>(`/api/reports/overtime-pay?month=${month}&${pageQs(q)}`),
  leavePayoutPage: (q: IPageQuery) => http<ILeavePayoutPage>(`/api/reports/leave-payout?${pageQs(q)}`),
  myLeavePayout: () => http<ILeavePayoutRow>('/api/reports/leave-payout/me'),
};

/** Link tải Excel (GET, cookie cùng origin). */
export const excelUrl = {
  timesheet: (month: string) => `/api/reports/timesheet.xlsx?month=${month}`,
  overtimePay: (month: string) => `/api/reports/overtime-pay.xlsx?month=${month}`,
  leavePayout: () => '/api/reports/leave-payout.xlsx',
};
