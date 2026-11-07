import { useQuery } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { reportApi, reportKeys } from '../api/report.api';

export const useOvertimePayPage = (month: string, q: IPageQuery) =>
  useQuery({ queryKey: reportKeys.overtimePayPage(month, q), queryFn: () => reportApi.overtimePayPage(month, q), placeholderData: (prev) => prev });
export const useLeavePayoutPage = (q: IPageQuery) =>
  useQuery({ queryKey: reportKeys.leavePayoutPage(q), queryFn: () => reportApi.leavePayoutPage(q), placeholderData: (prev) => prev });
/** Tiền phép ước tính của tôi (nếu nghỉ việc hôm nay). 404 khi chưa có hồ sơ nhân viên → không retry. */
export const useMyLeavePayout = () => useQuery({ queryKey: reportKeys.myLeavePayout, queryFn: reportApi.myLeavePayout, retry: false });
