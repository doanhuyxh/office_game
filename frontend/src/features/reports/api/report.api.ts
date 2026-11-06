import { http } from '@/services/api-client';
import type { ILeavePayoutRow, IOvertimePayReport } from '../types/report.types';

export const reportKeys = {
  all: ['reports'] as const,
  overtimePay: (month: string) => ['reports', 'overtime-pay', month] as const,
  leavePayout: ['reports', 'leave-payout'] as const,
  myLeavePayout: ['reports', 'leave-payout', 'me'] as const,
};

export const reportApi = {
  overtimePay: (month: string) => http<IOvertimePayReport>(`/api/reports/overtime-pay?month=${month}`),
  leavePayout: () => http<ILeavePayoutRow[]>('/api/reports/leave-payout'),
  myLeavePayout: () => http<ILeavePayoutRow>('/api/reports/leave-payout/me'),
};

/** Link tải Excel (GET, cookie cùng origin). */
export const excelUrl = {
  timesheet: (month: string) => `/api/reports/timesheet.xlsx?month=${month}`,
  overtimePay: (month: string) => `/api/reports/overtime-pay.xlsx?month=${month}`,
  leavePayout: () => '/api/reports/leave-payout.xlsx',
};
