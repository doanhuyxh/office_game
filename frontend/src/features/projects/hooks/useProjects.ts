import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/utils/errors';
import { projectApi, projectKeys } from '../api/project.api';
import type { ITask, ITaskColumn, ProjectStatus } from '../types/project.types';

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
/** Tab Phụ lục (phòng ban, thành viên, quyền hạn) — chỉ tải khi mở tab. */
export const useProjectAppendix = (id: string, enabled: boolean) => useQuery({ queryKey: projectKeys.appendix(id), queryFn: () => projectApi.appendix(id), enabled });
export const useAllFinancials = (status: ProjectStatus | undefined, enabled: boolean) =>
  useQuery({ queryKey: projectKeys.allFinancials(status), queryFn: () => projectApi.allFinancials(status), enabled });

/** Key của lệnh chuyển việc (kéo thả) — `useMutationState` đọc việc nào đang lưu. */
export const moveTaskKey = (projectId: string) => ['projects', 'move-task', projectId] as const;
export interface IMoveTaskArgs { task: ITask; column: ITaskColumn; note?: string }

/**
 * Chuyển việc sang cột khác, cập nhật bảng ngay (optimistic, TEST-72): đổi cột / done, đặt cuối cột đích (rank lớn nhất + 1 như back-end).
 * Lỗi → trả riêng việc đó về cột cũ (không đè việc khác đang chuyển) + toast. Xong → chỉ làm mới bảng việc, chi tiết dự án (đếm / tiến độ),
 * "việc của tôi", việc đó — và chỉ khi không còn lệnh chuyển nào khác đang chạy (refetch giữa chừng làm thẻ khác nhảy ngược).
 */
export function useMoveTask(projectId: string) {
  const qc = useQueryClient();
  const tasksKey = projectKeys.tasks(projectId);
  const patch = (id: string, fn: (t: ITask, all: ITask[]) => ITask) =>
    qc.setQueryData<ITask[]>(tasksKey, (all) => all && [...all.map((t) => (t.id === id ? fn(t, all) : t))].sort((a, b) => a.rank - b.rank));
  return useMutation({
    mutationKey: moveTaskKey(projectId),
    mutationFn: (a: IMoveTaskArgs) => projectApi.moveTask(a.task.id, a.column.id, a.note),
    onMutate: async ({ task, column }) => {
      await qc.cancelQueries({ queryKey: tasksKey });
      patch(task.id, (t, all) => ({
        ...t, columnId: column.id, columnName: column.name, columnColor: column.color, done: column.isDone,
        rank: Math.max(0, ...all.filter((x) => x.columnId === column.id && x.id !== t.id).map((x) => x.rank)) + 1,
      }));
    },
    onError: (err, { task, column }) => {
      patch(task.id, (t) => ({ ...t, columnId: task.columnId, columnName: task.columnName, columnColor: task.columnColor, done: task.done, rank: task.rank }));
      toast.error(`Không chuyển được ${task.code} sang "${column.name}": ${errorMessage(err)}`);
    },
    onSettled: (_d, _e, { task }) => {
      if (qc.isMutating({ mutationKey: moveTaskKey(projectId) }) > 1) return;
      for (const queryKey of [tasksKey, projectKeys.detail(projectId), projectKeys.myTasks, projectKeys.task(task.id)]) void qc.invalidateQueries({ queryKey });
    },
  });
}

/** Ghi dữ liệu dự án → làm mới ['projects'] (+ ['documents'] vì kho dự án / thành viên, + ['sales'] vì nghiệm thu đổi hạn đợt thu). */
export function useProjectMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { for (const k of ['projects', 'documents', 'sales']) void qc.invalidateQueries({ queryKey: [k] }); },
  });
}
