import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { projectApi, projectKeys } from '../api/project.api';
import type { ProjectStatus } from '../types/project.types';

export const useProjectList = (mine: boolean) => useQuery({ queryKey: projectKeys.list(mine), queryFn: () => projectApi.list(mine) });
export const useProject = (id: string) => useQuery({ queryKey: projectKeys.detail(id), queryFn: () => projectApi.get(id) });
export const useTasks = (id: string) => useQuery({ queryKey: projectKeys.tasks(id), queryFn: () => projectApi.tasks(id) });
export const useMyTasks = () => useQuery({ queryKey: projectKeys.myTasks, queryFn: projectApi.myTasks });
/** Việc + bình luận + lịch sử (hộp thoại việc). */
export const useTaskDetail = (taskId: string | null) => useQuery({ queryKey: projectKeys.task(taskId ?? ''), queryFn: () => projectApi.task(taskId!), enabled: !!taskId });
export const useEffort = (id: string, enabled: boolean) => useQuery({ queryKey: projectKeys.effort(id), queryFn: () => projectApi.effort(id), enabled });
export const useSalesContractSearch = (search: string, enabled: boolean) =>
  useQuery({ queryKey: projectKeys.contracts(search), queryFn: () => projectApi.salesContracts(search), enabled });
/** Đợt thu của mọi hợp đồng gắn dự án (không có tiền). */
export const useInstallments = (projectId: string | null | undefined) =>
  useQuery({ queryKey: projectKeys.installments(projectId ?? ''), queryFn: () => projectApi.installments(projectId!), enabled: !!projectId });
/** Lãi / lỗ — chỉ bật khi có quyền Xem tài chính (back-end trả 403 nếu không). */
export const useFinancials = (id: string, enabled: boolean) => useQuery({ queryKey: projectKeys.financials(id), queryFn: () => projectApi.financials(id), enabled });
export const useChangeRequests = (id: string) => useQuery({ queryKey: projectKeys.changeRequests(id), queryFn: () => projectApi.changeRequests(id) });
/** Giới hạn đội agent — chỉ admin (back-end 403 nếu không). */
export const useAgentSettings = () => useQuery({ queryKey: projectKeys.agentSettings, queryFn: projectApi.agentSettings });
export const useAllFinancials = (status: ProjectStatus | undefined, enabled: boolean) =>
  useQuery({ queryKey: projectKeys.allFinancials(status), queryFn: () => projectApi.allFinancials(status), enabled });

/** Ghi dữ liệu dự án → làm mới ['projects'] (+ ['documents'] vì kho dự án / thành viên, + ['sales'] vì nghiệm thu đổi hạn đợt thu). */
export function useProjectMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { for (const k of ['projects', 'documents', 'sales']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
}
