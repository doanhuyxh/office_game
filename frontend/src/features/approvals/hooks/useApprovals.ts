import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approvalApi, approvalKeys } from '../api/approval.api';

export const useInbox = () => useQuery({ queryKey: approvalKeys.inbox, queryFn: approvalApi.inbox });
export const useMyApprovals = () => useQuery({ queryKey: approvalKeys.mine, queryFn: approvalApi.mine });
/** Số đơn chờ tôi duyệt (badge menu). */
export const useInboxCount = () =>
  useQuery({ queryKey: approvalKeys.inboxCount, queryFn: approvalApi.inboxCount, refetchInterval: 60_000, select: (d) => d.count });

/**
 * Duyệt / từ chối / huỷ làm thay đổi dữ liệu ở module sở hữu đơn (nghỉ phép, chấm công)
 * → làm mới cả các nhánh cache đó.
 */
function useInvalidateAfterDecision() {
  const qc = useQueryClient();
  return () => Promise.all(['approval', 'leave', 'attendance'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useApprove() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({ mutationFn: (v: { id: string; comment?: string }) => approvalApi.approve(v.id, v.comment), onSuccess: invalidate });
}
export function useReject() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({ mutationFn: (v: { id: string; comment: string }) => approvalApi.reject(v.id, v.comment), onSuccess: invalidate });
}
export function useCancelApproval() {
  const invalidate = useInvalidateAfterDecision();
  return useMutation({ mutationFn: (id: string) => approvalApi.cancel(id), onSuccess: invalidate });
}

/** Uỷ quyền duyệt của tôi (đã giao / được nhận). */
export const useMyDelegations = () => useQuery({ queryKey: approvalKeys.myDelegations, queryFn: approvalApi.myDelegations });
/** HR: mọi uỷ quyền. */
export const useAllDelegations = (status: 'current' | 'all', enabled: boolean) =>
  useQuery({ queryKey: approvalKeys.allDelegations(status), queryFn: () => approvalApi.allDelegations(status), enabled });

/** Tạo / thu hồi uỷ quyền đổi luôn hộp duyệt của người được uỷ quyền → làm mới cả nhánh 'approval'. */
export function useCreateDelegation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: approvalApi.createDelegation, onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }) });
}
export function useRevokeDelegation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: approvalApi.revokeDelegation, onSuccess: () => qc.invalidateQueries({ queryKey: approvalKeys.all }) });
}
