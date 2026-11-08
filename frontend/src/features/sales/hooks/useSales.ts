import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { salesApi, salesKeys } from '../api/sales.api';
import type { ContractStatus, InstallmentState } from '../types/sales.types';

export const useCustomers = (search: string, inactive: boolean, q: IPageQuery) =>
  useQuery({ queryKey: salesKeys.customers(search, inactive, q), queryFn: () => salesApi.customers(search, inactive, q), placeholderData: (prev) => prev });
export const useCustomer = (id: string | null) => useQuery({ queryKey: salesKeys.customer(id ?? ''), queryFn: () => salesApi.customer(id!), enabled: !!id });
export const useOpportunities = () => useQuery({ queryKey: salesKeys.opportunities, queryFn: salesApi.opportunities });
export const useContracts = (search: string, status: ContractStatus | undefined, q: IPageQuery) =>
  useQuery({ queryKey: salesKeys.contracts(search, status, q), queryFn: () => salesApi.contracts(search, status, q), placeholderData: (prev) => prev });
export const useContract = (id: string | null) => useQuery({ queryKey: salesKeys.contract(id ?? ''), queryFn: () => salesApi.contract(id!), enabled: !!id });
export const useReceivables = (state: InstallmentState | undefined) => useQuery({ queryKey: salesKeys.receivables(state), queryFn: () => salesApi.receivables(state) });
export const useUpcoming = () => useQuery({ queryKey: salesKeys.upcoming, queryFn: salesApi.upcoming });

/** Mọi ghi dữ liệu kinh doanh → làm mới ['sales'] + ['finance'] (ghi nhận thu sinh dòng sổ, đổi số dư quỹ). */
export function useSalesMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: salesKeys.all }); void qc.invalidateQueries({ queryKey: ['finance'] }); },
  });
}
