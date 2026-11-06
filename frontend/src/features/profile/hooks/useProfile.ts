import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api-client';
import { profileApi, profileKeys } from '../api/profile.api';
import type { IContact, ISensitive, ISensitiveChange } from '../types/profile.types';

/** Hồ sơ của tôi. null = tài khoản chưa gắn hồ sơ nhân viên (admin hệ thống). */
export const useMyProfile = () => useQuery({
  queryKey: profileKeys.me, retry: false, staleTime: 60_000,
  queryFn: () => profileApi.me().catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
});

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: profileKeys.all }), qc.invalidateQueries({ queryKey: ['org'] })]);
}
export function useSaveContact() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (c: IContact) => profileApi.saveContact(c), onSuccess: invalidate });
}
export function useUploadAvatar() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (f: File) => profileApi.uploadAvatar(f), onSuccess: invalidate });
}
export function useDeleteAvatar() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: profileApi.deleteAvatar, onSuccess: invalidate });
}
export function useSubmitProfileRequest() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { change: ISensitiveChange; note: string | null }) => profileApi.submit(v.change, v.note), onSuccess: invalidate });
}
export function useCancelProfileRequest() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: profileApi.cancel, onSuccess: invalidate });
}
// HR
export const useProfileRequests = (status?: string, enabled = true) =>
  useQuery({ queryKey: profileKeys.requests(status), queryFn: () => profileApi.requests(status), enabled });
export function useDecideProfileRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; approve: boolean; reason?: string }) => (v.approve ? profileApi.approve(v.id).then(() => undefined) : profileApi.reject(v.id, v.reason ?? '')),
    onSuccess: invalidate,
  });
}
export const useEmployeePrivate = (id: string | null) =>
  useQuery({ queryKey: profileKeys.employee(id ?? ''), queryFn: () => profileApi.employee(id!), enabled: !!id });
export function useSaveEmployeePrivate() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { id: string; contact: IContact; sensitive: ISensitive }) => profileApi.saveEmployee(v.id, v.contact, v.sensitive), onSuccess: invalidate });
}
