import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { payrollApi, payrollKeys } from '../api/payroll.api';
import type { IPayrollRules } from '../types/payroll.types';

export const useSettings = () => useQuery({ queryKey: payrollKeys.settings, queryFn: payrollApi.settings });
export const useProfiles = () => useQuery({ queryKey: payrollKeys.profiles, queryFn: payrollApi.profiles });
export const usePeriods = () => useQuery({ queryKey: payrollKeys.periods, queryFn: payrollApi.periods });
export const usePeriod = (id: string | null) => useQuery({ queryKey: payrollKeys.period(id ?? ''), queryFn: () => payrollApi.period(id!), enabled: !!id });
export const useMyPayslips = () => useQuery({ queryKey: payrollKeys.my, queryFn: payrollApi.my, retry: false });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: payrollKeys.all });
}
export function useSaveSettings() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (v: { effectiveFrom: string; rules: IPayrollRules }) => payrollApi.saveSettings(v.effectiveFrom, v.rules), onSuccess: inv });
}
export function useSaveProfile() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (v: { employeeId: string; dependents: number; insured: boolean | null; taxCode: string | null; note: string | null }) =>
    payrollApi.saveProfile(v.employeeId, v), onSuccess: inv });
}
export function usePeriodAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (v: { id: string; action: 'compute' | 'lock' | 'unlock' }) => payrollApi[v.action](v.id),
    onSuccess: inv,
  });
}
export function useCreatePeriod() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: payrollApi.createPeriod, onSuccess: inv });
}
export function useAddAdjustment() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (v: { periodId: string; employeeId: string; label: string; amount: number; taxable: boolean }) =>
    payrollApi.addAdjustment(v.periodId, v), onSuccess: inv });
}
export function useDeleteAdjustment() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: payrollApi.deleteAdjustment, onSuccess: inv });
}
