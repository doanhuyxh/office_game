import { http, pageQs } from '@/services/api-client';
import type { IPageQuery } from '@/types/api';
import type {
  AiUsageSort, IAiUsageFilter, IAiUsageReport, IAiUsageUsersPage, ILeavePayoutPage, ILeavePayoutRow, IOvertimePayPage,
} from '../types/report.types';

export const reportKeys = {
  all: ['reports'] as const,
  overtimePayPage: (month: string, q: IPageQuery) => ['reports', 'overtime-pay', month, q] as const,
  leavePayoutPage: (q: IPageQuery) => ['reports', 'leave-payout', 'page', q] as const,
  myLeavePayout: ['reports', 'leave-payout', 'me'] as const,
  aiUsage: (f: IAiUsageFilter, userId: string | null) => ['reports', 'ai-usage', f, userId] as const,
  aiUsageUsers: (f: IAiUsageFilter, sort: AiUsageSort, q: IPageQuery) => ['reports', 'ai-usage', 'users', f, sort, q] as const,
};

/** Query string bộ lọc báo cáo AI (bỏ giá trị trống). */
const aiUsageQs = (f: IAiUsageFilter, extra: Record<string, string | null | undefined> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, String(v));
  return p.toString();
};

export const reportApi = {
  overtimePayPage: (month: string, q: IPageQuery) => http<IOvertimePayPage>(`/api/reports/overtime-pay?month=${month}&${pageQs(q)}`),
  leavePayoutPage: (q: IPageQuery) => http<ILeavePayoutPage>(`/api/reports/leave-payout?${pageQs(q)}`),
  myLeavePayout: () => http<ILeavePayoutRow>('/api/reports/leave-payout/me'),
  aiUsage: (f: IAiUsageFilter, userId: string | null) => http<IAiUsageReport>(`/api/audit/ai-usage?${aiUsageQs(f, { userId })}`),
  aiUsageUsers: (f: IAiUsageFilter, sort: AiUsageSort, q: IPageQuery) =>
    http<IAiUsageUsersPage>(`/api/audit/ai-usage/users?${aiUsageQs(f, { sort })}&${pageQs(q)}`),
};

/** Link tải Excel (GET, cookie cùng origin). */
export const excelUrl = {
  timesheet: (month: string) => `/api/reports/timesheet.xlsx?month=${month}`,
  overtimePay: (month: string) => `/api/reports/overtime-pay.xlsx?month=${month}`,
  leavePayout: () => '/api/reports/leave-payout.xlsx',
};
