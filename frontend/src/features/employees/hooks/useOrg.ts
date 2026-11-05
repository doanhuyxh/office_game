import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { departmentsApi, employeesApi, orgKeys, positionsApi } from '../api/org.api';
import type { AccountMode, IEmployeeFilter, IUpsertDepartment, IUpsertEmployee, IUpsertPosition } from '../types/employee.types';

// ---------- Đọc ----------
export const useEmployees = (f: IEmployeeFilter = {}) =>
  useQuery({ queryKey: orgKeys.employees(f), queryFn: () => employeesApi.list(f), placeholderData: (prev) => prev });
export const useDepartments = () => useQuery({ queryKey: orgKeys.departments, queryFn: departmentsApi.list });
export const usePositions = () => useQuery({ queryKey: orgKeys.positions, queryFn: positionsApi.list });
export const useNextEmployeeCode = (enabled: boolean) =>
  useQuery({ queryKey: ['org', 'next-code'], queryFn: employeesApi.nextCode, enabled, staleTime: 0 });

/** Mọi thay đổi trong module org → làm mới toàn bộ dữ liệu org (công ty nhỏ, rẻ). */
function useInvalidateOrg() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: orgKeys.all });
}

// ---------- Nhân viên ----------
export function useSaveEmployee() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: IUpsertEmployee }) => (id ? employeesApi.update(id, body) : employeesApi.create(body)),
    onSuccess: invalidate,
  });
}

export function useResignEmployee() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: ({ id, leftAt }: { id: string; leftAt: string }) => employeesApi.resign(id, leftAt), onSuccess: invalidate });
}

export function useReactivateEmployee() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: (id: string) => employeesApi.reactivate(id), onSuccess: invalidate });
}

// ---------- Tài khoản ----------
export function useCreateAccount() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: (v: { id: string; mode: AccountMode; roles: string[]; userName?: string }) =>
      employeesApi.createAccount(v.id, v.mode, v.roles, v.userName),
    onSuccess: invalidate,
  });
}

export const useResendInvite = () => useMutation({ mutationFn: (id: string) => employeesApi.resendInvite(id) });

export function useResetAccountPassword() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: (id: string) => employeesApi.resetPassword(id), onSuccess: invalidate });
}

export function useSetRoles() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: ({ id, roles }: { id: string; roles: string[] }) => employeesApi.setRoles(id, roles), onSuccess: invalidate });
}

// ---------- Phòng ban / chức vụ ----------
export function useSaveDepartment() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: IUpsertDepartment }) => { if (id) await departmentsApi.update(id, body); else await departmentsApi.create(body); },
    onSuccess: invalidate,
  });
}

export function useDeleteDepartment() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: (id: string) => departmentsApi.remove(id), onSuccess: invalidate });
}

export function useSavePosition() {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: string; body: IUpsertPosition }) => { if (id) await positionsApi.update(id, body); else await positionsApi.create(body); },
    onSuccess: invalidate,
  });
}

export function useDeletePosition() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: (id: string) => positionsApi.remove(id), onSuccess: invalidate });
}
