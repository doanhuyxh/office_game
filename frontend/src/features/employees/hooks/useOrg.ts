import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api-client';
import type { IPageQuery } from '@/types/api';
import { departmentsApi, employeesApi, guidesApi, orgKeys, positionsApi } from '../api/org.api';
import type { AccountMode, IBulkUpdateEmployees, IEmployeeFilter, IUpsertDepartment, IUpsertEmployee, IUpsertPosition } from '../types/employee.types';

// ---------- Đọc ----------
export const useEmployees = (f: IEmployeeFilter = {}) =>
  useQuery({ queryKey: orgKeys.employees(f), queryFn: () => employeesApi.list(f), placeholderData: (prev) => prev });
/** Danh bạ theo trang (giữ trang cũ khi đang tải trang mới). */
export const useEmployeesPage = (f: IEmployeeFilter, q: IPageQuery) =>
  useQuery({ queryKey: orgKeys.employeesPage(f, q), queryFn: () => employeesApi.listPage(f, q), placeholderData: (prev) => prev });
export const useDepartments = () => useQuery({ queryKey: orgKeys.departments, queryFn: departmentsApi.list });
export const usePositions = () => useQuery({ queryKey: orgKeys.positions, queryFn: positionsApi.list });
/** Quyền tài chính của tôi (theo chức vụ) — dùng ẩn / hiện menu và ô cấu hình; back-end vẫn kiểm tra lại. */
export const useMyFinanceAccess = () => useQuery({ queryKey: [...orgKeys.all, 'my-finance'], queryFn: positionsApi.myFinance, staleTime: 60_000 });
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

export function useBulkUpdateEmployees() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: (body: IBulkUpdateEmployees) => employeesApi.bulkUpdate(body), onSuccess: invalidate });
}

export function useBulkResignEmployees() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: ({ ids, leftAt }: { ids: string[]; leftAt: string }) => employeesApi.bulkResign(ids, leftAt), onSuccess: invalidate });
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

export function useResetTwoFactor() {
  const invalidate = useInvalidateOrg();
  return useMutation({ mutationFn: (id: string) => employeesApi.resetTwoFactor(id), onSuccess: invalidate });
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

// ---------- Mô tả + hướng dẫn ----------
export const useDepartmentDetail = (id: string | null) =>
  useQuery({ queryKey: orgKeys.department(id ?? ''), queryFn: () => guidesApi.department(id!), enabled: !!id });
export const usePositionDetail = (id: string | null) =>
  useQuery({ queryKey: orgKeys.position(id ?? ''), queryFn: () => guidesApi.position(id!), enabled: !!id });
export const useGuideTemplates = () => useQuery({ queryKey: orgKeys.guideTemplates, queryFn: guidesApi.templates, staleTime: Infinity });
/** 404 no_employee_profile → null (admin hệ thống không có hồ sơ). */
export const useMyRole = () => useQuery({
  queryKey: orgKeys.myRole, retry: false,
  queryFn: () => guidesApi.myRole().catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }),
});
export function useSaveGuide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: 'department' | 'position'; id: string; description: string | null; guide: string | null }) =>
      v.kind === 'department' ? guidesApi.saveDepartment(v.id, v) : guidesApi.savePosition(v.id, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKeys.all }),
  });
}
