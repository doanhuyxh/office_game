import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectApi, projectKeys } from '../api/project.api';

export const useProjectList = (mine: boolean) => useQuery({ queryKey: projectKeys.list(mine), queryFn: () => projectApi.list(mine) });
export const useProject = (id: string) => useQuery({ queryKey: projectKeys.detail(id), queryFn: () => projectApi.get(id) });
export const useTasks = (id: string) => useQuery({ queryKey: projectKeys.tasks(id), queryFn: () => projectApi.tasks(id) });
export const useMyTasks = () => useQuery({ queryKey: projectKeys.myTasks, queryFn: projectApi.myTasks });
export const useComments = (taskId: string | null) => useQuery({ queryKey: projectKeys.comments(taskId ?? ''), queryFn: () => projectApi.comments(taskId!), enabled: !!taskId });
export const useEffort = (id: string, enabled: boolean) => useQuery({ queryKey: projectKeys.effort(id), queryFn: () => projectApi.effort(id), enabled });
export const useSalesContractSearch = (search: string, enabled: boolean) =>
  useQuery({ queryKey: projectKeys.contracts(search), queryFn: () => projectApi.salesContracts(search), enabled });
export const useInstallments = (contractId: string | null | undefined) =>
  useQuery({ queryKey: projectKeys.installments(contractId ?? ''), queryFn: () => projectApi.installments(contractId!), enabled: !!contractId });

/** Ghi dữ liệu dự án → làm mới ['projects'] (+ ['documents'] vì kho dự án / thành viên, + ['sales'] vì nghiệm thu đổi hạn đợt thu). */
export function useProjectMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { for (const k of ['projects', 'documents', 'sales']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
}
