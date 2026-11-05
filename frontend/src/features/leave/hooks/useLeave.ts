import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api-client';
import { leaveApi, leaveKeys } from '../api/leave.api';
import type { ICreateLeave, LeavePeriod } from '../types/leave.types';

export const useLeaveTypes = () => useQuery({ queryKey: leaveKeys.types, queryFn: leaveApi.types, staleTime: 5 * 60_000 });

/** `noProfile` = tài khoản chưa gắn hồ sơ nhân viên (admin hệ thống). */
export function useMyBalance() {
  const q = useQuery({ queryKey: leaveKeys.balance, queryFn: leaveApi.balance, retry: false });
  return { ...q, noProfile: q.error instanceof ApiError && q.error.problem.title === 'no_employee_profile' };
}
export const useMyLeaves = () => useQuery({ queryKey: leaveKeys.my, queryFn: leaveApi.my, retry: false });
export const useTeamLeaves = (from: string, to: string) => useQuery({ queryKey: leaveKeys.team(from, to), queryFn: () => leaveApi.team(from, to) });
export const useAllBalances = (enabled: boolean) => useQuery({ queryKey: leaveKeys.balances, queryFn: leaveApi.balances, enabled });
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
