import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api-client';
import { contractApi, contractKeys } from '../api/contract.api';
import type { ICreateAmendment, IUpsertContract } from '../types/contract.types';

/** HR: mọi hợp đồng. */
export const useContracts = (enabled = true) => useQuery({ queryKey: contractKeys.list, queryFn: contractApi.list, enabled });

/** Hợp đồng của tôi. `noProfile` = tài khoản chưa gắn hồ sơ nhân viên (admin hệ thống). */
export function useMyContracts() {
  const q = useQuery({ queryKey: contractKeys.my, queryFn: contractApi.my, retry: false });
  const noProfile = q.error instanceof ApiError && q.error.problem.title === 'no_employee_profile';
  return { ...q, noProfile };
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: contractKeys.all });
}

export function useSaveContract() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: IUpsertContract }) => (id ? contractApi.update(id, body) : contractApi.create(body)),
    onSuccess: invalidate,
  });
}
export function useTerminateContract() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { id: string; terminatedOn: string; reason: string }) => contractApi.terminate(v.id, v.terminatedOn, v.reason), onSuccess: invalidate });
}
export function useDeleteContract() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => contractApi.remove(id), onSuccess: invalidate });
}
export function useAddAmendment() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { id: string; body: ICreateAmendment }) => contractApi.addAmendment(v.id, v.body), onSuccess: invalidate });
}
export function useDeleteAmendment() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { id: string; amendmentId: string }) => contractApi.removeAmendment(v.id, v.amendmentId), onSuccess: invalidate });
}
export function useUploadContractFile() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { id: string; file: File; amendmentId?: string }) => contractApi.uploadFile(v.id, v.file, v.amendmentId), onSuccess: invalidate });
}

// ---------- Mẫu hợp đồng (HR) ----------
export const useTemplates = (enabled = true) => useQuery({ queryKey: contractKeys.templates, queryFn: contractApi.templates, enabled });
export const useTemplateFields = () => useQuery({ queryKey: contractKeys.templateFields, queryFn: contractApi.templateFields, staleTime: Infinity });
export function useUploadTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { file: File; name: string; contractType: string | null }) => contractApi.uploadTemplate(v.file, v.name, v.contractType),
    onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.templates }),
  });
}
export function useRemoveTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: contractApi.removeTemplate, onSuccess: () => qc.invalidateQueries({ queryKey: contractKeys.templates }) });
}
