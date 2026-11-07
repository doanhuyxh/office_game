import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api-client';
import type { IPageQuery } from '@/types/api';
import { leaveApi, leaveKeys } from '../api/leave.api';
import type { ICreateLeave, LeavePeriod } from '../types/leave.types';

export const useLeaveTypes = () => useQuery({ queryKey: leaveKeys.types, queryFn: leaveApi.types, staleTime: 5 * 60_000 });

/** `noProfile` = tài khoản chưa gắn hồ sơ nhân viên (admin hệ thống). */
export function useMyBalance() {
  const q = useQuery({ queryKey: leaveKeys.balance, queryFn: leaveApi.balance, retry: false });
  return { ...q, noProfile: q.error instanceof ApiError && q.error.problem.title === 'no_employee_profile' };
}
export const useMyLeavesPage = (q: IPageQuery) =>
  useQuery({ queryKey: leaveKeys.myPage(q), queryFn: () => leaveApi.myPage(q), retry: false, placeholderData: (prev) => prev });
export const useTeamLeavesPage = (from: string, to: string, q: IPageQuery) =>
  useQuery({ queryKey: leaveKeys.teamPage(from, to, q), queryFn: () => leaveApi.teamPage(from, to, q), placeholderData: (prev) => prev });
/** HR: số dư phép theo trang (BE chỉ tính cho nhân viên trong trang). */
export const useAllBalancesPage = (q: IPageQuery, enabled = true) =>
  useQuery({ queryKey: leaveKeys.balancesPage(q), queryFn: () => leaveApi.balancesPage(q), enabled, placeholderData: (prev) => prev });
export const useLeavePreview = (start: string, end: string, period: LeavePeriod) =>
  useQuery({
    queryKey: leaveKeys.preview(start, end, period),
    queryFn: () => leaveApi.preview(start, end, period),
    enabled: !!start && !!end && end >= start,
    retry: false,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: leaveKeys.all }), qc.invalidateQueries({ queryKey: ['approval'] })]);
}

export function useCreateLeave() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: ICreateLeave) => leaveApi.create(body), onSuccess: invalidate });
}
export function useAdjustLeave() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { employeeId: string; days: number; reason: string }) => leaveApi.adjust(v.employeeId, v.days, v.reason), onSuccess: invalidate });
}
