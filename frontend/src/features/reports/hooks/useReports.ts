import { useQuery } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import type { AiUsageSort, IAiUsageFilter } from '../types/report.types';
import { reportApi, reportKeys } from '../api/report.api';

export const useOvertimePayPage = (month: string, q: IPageQuery) =>
  useQuery({ queryKey: reportKeys.overtimePayPage(month, q), queryFn: () => reportApi.overtimePayPage(month, q), placeholderData: (prev) => prev });
export const useLeavePayoutPage = (q: IPageQuery) =>
  useQuery({ queryKey: reportKeys.leavePayoutPage(q), queryFn: () => reportApi.leavePayoutPage(q), placeholderData: (prev) => prev });
/** Tiền phép ước tính của tôi (nếu nghỉ việc hôm nay). 404 khi chưa có hồ sơ nhân viên → không retry. */
export const useMyLeavePayout = () => useQuery({ queryKey: reportKeys.myLeavePayout, queryFn: reportApi.myLeavePayout, retry: false });

/** Báo cáo sử dụng trợ lý AI: tổng hợp, theo ngày, tool, ứng dụng. `userId` = chi tiết một người (kèm IP). */
export const useAiUsage = (f: IAiUsageFilter, userId: string | null = null, enabled = true) =>
  useQuery({ queryKey: reportKeys.aiUsage(f, userId), queryFn: () => reportApi.aiUsage(f, userId), enabled, placeholderData: (prev) => prev });
/** Xếp hạng theo người (phân trang ở back-end). */
export const useAiUsageUsersPage = (f: IAiUsageFilter, sort: AiUsageSort, q: IPageQuery) =>
  useQuery({ queryKey: reportKeys.aiUsageUsers(f, sort, q), queryFn: () => reportApi.aiUsageUsers(f, sort, q), placeholderData: (prev) => prev });
