import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FINANCE_PERMISSION, useMyFinanceAccess } from '@/features/employees';
import type { IPageQuery } from '@/types/api';
import { financeApi, financeKeys } from '../api/finance.api';
import type { AttachmentOwner, ExpenseStatus, IEntryFilter } from '../types/finance.types';

/** Quyền tài chính của tôi (theo chức vụ). Chỉ để ẩn / hiện giao diện — back-end kiểm tra lại mọi request. */
export function useFinancePerms() {
  const q = useMyFinanceAccess();
  const p = q.data?.permissions ?? 0;
  return {
    loading: q.isLoading,
    view: (p & FINANCE_PERMISSION.view) !== 0,
    record: (p & FINANCE_PERMISSION.record) !== 0,
    approve: (p & FINANCE_PERMISSION.approve) !== 0,
    admin: (p & FINANCE_PERMISSION.admin) !== 0,
  };
}

export const useOverview = (enabled: boolean) => useQuery({ queryKey: financeKeys.overview, queryFn: financeApi.overview, enabled });
export const useAccounts = (enabled = true) => useQuery({ queryKey: financeKeys.accounts, queryFn: financeApi.accounts, enabled });
export const useLines = () => useQuery({ queryKey: financeKeys.lines, queryFn: financeApi.lines, staleTime: 5 * 60_000 });
export const useCategories = () => useQuery({ queryKey: financeKeys.categories, queryFn: financeApi.categories, staleTime: 5 * 60_000 });
export const useFinanceProjects = (enabled = true) => useQuery({ queryKey: financeKeys.projects, queryFn: financeApi.projects, enabled, staleTime: 60_000 });
export const useAttachments = (type: AttachmentOwner, id: string | null) =>
  useQuery({ queryKey: financeKeys.attachments(type, id ?? ''), queryFn: () => financeApi.attachments(type, id!), enabled: !!id });
export const useLock = (enabled: boolean) => useQuery({ queryKey: financeKeys.lock, queryFn: financeApi.lock, enabled });
export const useEntries = (f: IEntryFilter, q: IPageQuery) =>
  useQuery({ queryKey: financeKeys.entries(f, q), queryFn: () => financeApi.entries(f, q), placeholderData: (prev) => prev });
export const useExpenses = (scope: 'mine' | 'all', status: ExpenseStatus | undefined, q: IPageQuery) =>
  useQuery({ queryKey: financeKeys.expenses(scope, status, q), queryFn: () => financeApi.expenses(scope, status, q), placeholderData: (prev) => prev });

/** Mọi ghi dữ liệu tài chính → làm mới toàn bộ ['finance'] (số dư, tổng quan, danh sách đều phụ thuộc nhau) + phê duyệt. */
export function useFinanceMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: financeKeys.all }); void qc.invalidateQueries({ queryKey: ['approval'] }); },
  });
}
