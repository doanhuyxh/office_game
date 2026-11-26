import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { errorMessage } from '@/utils/errors';
import { projectApi, projectKeys } from '../api/project.api';
import type { IBulkTasksRequest, ITask, ITaskColumn, ProjectStatus } from '../types/project.types';

export const useProjectList = (mine: boolean) => useQuery({ queryKey: projectKeys.list(mine), queryFn: () => projectApi.list(mine) });
/**
 * Chi tiết dự án + danh sách việc (bản gọn) — TEST-241: `staleTime` 30 giây → quay lại trang / dự án trong 30 giây hiện ngay cache, không gọi lại;
 * quá 30 giây hiện cache rồi làm mới nền. Thay đổi của người khác vẫn tới qua `ProjectLiveUpdates` (invalidate bỏ qua staleTime),
 * lệnh ghi của mình qua `useProjectMutation` / `useMoveTask`. Dùng chung cho `useProject` / `useTasks` và prefetch (rê chuột ở /projects).
 */
export const PROJECT_STALE_MS = 30_000;
export const projectDetailQuery = (id: string) => queryOptions({ queryKey: projectKeys.detail(id), queryFn: () => projectApi.get(id), staleTime: PROJECT_STALE_MS });
export const projectTasksQuery = (id: string) => queryOptions({ queryKey: projectKeys.tasks(id), queryFn: () => projectApi.tasks(id), staleTime: PROJECT_STALE_MS });
export const useProject = (id: string) => useQuery(projectDetailQuery(id));
export const useTasks = (id: string, enabled = true) => useQuery({ ...projectTasksQuery(id), enabled });
/** Tải trước chi tiết (+ danh sách việc) của một dự án — loader route `/projects/$projectId` (chạy song song với tải chunk trang),
 *  rê chuột / focus thẻ dự án ở /projects. Không chờ (fire-and-forget); còn mới (< 30 giây) thì không gọi. */
export const prefetchProject = (qc: QueryClient, id: string, tasks = true) => {
  void qc.prefetchQuery(projectDetailQuery(id));
  if (tasks) void qc.prefetchQuery(projectTasksQuery(id));
};
export const useMyTasks = () => useQuery({ queryKey: projectKeys.myTasks, queryFn: projectApi.myTasks });
/** Việc + lịch sử (hộp thoại việc) — không kèm bình luận, dùng `useTaskComments`. */
export const taskDetailQuery = (taskId: string) => queryOptions({ queryKey: projectKeys.task(taskId), queryFn: () => projectApi.task(taskId) });
export const useTaskDetail = (taskId: string | null) => useQuery({ ...taskDetailQuery(taskId ?? ''), enabled: !!taskId });
/** Tải trước chi tiết việc (TEST-242) khi rê chuột / focus thẻ kanban hoặc dòng Danh sách → mở hộp thoại hiện ngay, không khung xương.
 *  Đã tải trong 30 giây thì không gọi lại; `useTaskDetail` (staleTime 0) vẫn làm mới nền khi mở. */
export const prefetchTask = (qc: QueryClient, taskId: string) => void qc.prefetchQuery({ ...taskDetailQuery(taskId), staleTime: PROJECT_STALE_MS });
/** Bình luận của việc (TEST-194). Làm mới: `useProjectMutation` invalidate cả tiền tố ['projects'] nên gồm luôn khoá này;
 *  `ProjectLiveUpdates` (TEST-241) invalidate đúng `comments(taskId)` của việc có hoạt động. */
export const useTaskComments = (taskId: string | null) =>
  useQuery({ queryKey: projectKeys.comments(taskId ?? ''), queryFn: () => projectApi.comments(taskId!), enabled: !!taskId });
/** Link tải lên còn hạn của tôi trên việc (TEST-175). */
export const useUploadLinks = (taskId: string, enabled: boolean) =>
  useQuery({ queryKey: projectKeys.uploadLinks(taskId), queryFn: () => projectApi.uploadLinks(taskId), enabled });
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

/** Thao tác hàng loạt trên việc của dự án (`POST /tasks/bulk`, thành công từng phần) — làm mới như mọi lệnh ghi dự án. */
export const useBulkTasks = (projectId: string) => useProjectMutation((b: IBulkTasksRequest) => projectApi.bulkTasks(projectId, b));
