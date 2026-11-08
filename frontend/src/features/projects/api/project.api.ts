import { http, httpPost } from '@/services/api-client';
import type {
  IComment, IEffort, IInstallmentRef, IMilestoneRequest, IProject, IProjectDetail, IProjectFinancials, IProjectRequest, ISalesContractRef, ITask, ITaskRequest, MemberRole,
  ProjectStatus, TaskState, ChangeRequestStatus, IChangeRequest, IChangeRequestRequest,
} from '../types/project.types';

const base = '/api/projects';
const send = <T>(method: string, url: string, body?: unknown) => http<T>(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const projectKeys = {
  all: ['projects'] as const,
  list: (mine: boolean) => ['projects', 'list', mine] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  tasks: (id: string) => ['projects', 'tasks', id] as const,
  myTasks: ['projects', 'my-tasks'] as const,
  comments: (taskId: string) => ['projects', 'comments', taskId] as const,
  effort: (id: string) => ['projects', 'effort', id] as const,
  contracts: (search: string) => ['projects', 'sales-contracts', search] as const,
  installments: (projectId: string) => ['projects', 'installments', projectId] as const,
  financials: (id: string) => ['projects', 'financials', id] as const,
  changeRequests: (id: string) => ['projects', 'change-requests', id] as const,
  allFinancials: (status: ProjectStatus | undefined) => ['projects', 'financials', 'all', status] as const,
};

export const projectApi = {
  list: (mine: boolean) => http<IProject[]>(`${base}${mine ? '?mine=true' : ''}`),
  get: (id: string) => http<IProjectDetail>(`${base}/${id}`),
  save: (id: string | undefined, b: IProjectRequest): Promise<unknown> => (id ? send('PUT', `${base}/${id}`, b) : httpPost<string>(base, b)),
  addMembers: (id: string, employeeIds: string[], role: MemberRole) => httpPost<void>(`${base}/${id}/members`, { employeeIds, role }),
  changeRole: (id: string, employeeId: string, role: MemberRole) => send<void>('PUT', `${base}/${id}/members/${employeeId}`, { role }),
  removeMember: (id: string, employeeId: string) => send<void>('DELETE', `${base}/${id}/members/${employeeId}`),
  setAllocations: (id: string, month: string, items: { employeeId: string; percent: number | null }[]) => send<void>('PUT', `${base}/${id}/allocations`, { month, items }),
  effort: (id: string) => http<IEffort>(`${base}/${id}/effort`),
  salesContracts: (search: string) => http<ISalesContractRef[]>(`${base}/sales-contracts?search=${encodeURIComponent(search)}`),
  installments: (projectId: string) => http<IInstallmentRef[]>(`${base}/${projectId}/installments`),
  financials: (id: string) => http<IProjectFinancials>(`${base}/${id}/financials`),
  changeRequests: (id: string) => http<IChangeRequest[]>(`${base}/${id}/change-requests`),
  saveChangeRequest: (projectId: string, cid: string | undefined, b: IChangeRequestRequest): Promise<unknown> =>
    (cid ? send('PUT', `${base}/change-requests/${cid}`, b) : httpPost<string>(`${base}/${projectId}/change-requests`, b)),
  moveChangeRequest: (cid: string, status: ChangeRequestStatus, decidedOn?: string | null, note?: string | null) =>
    httpPost<void>(`${base}/change-requests/${cid}/status`, { status, decidedOn: decidedOn || null, note: note || null }),
  allFinancials: (status?: ProjectStatus) => http<IProjectFinancials[]>(`${base}/financials${status ? `?status=${status}` : ''}`),
  addMilestone: (id: string, b: IMilestoneRequest) => httpPost<string>(`${base}/${id}/milestones`, b),
  updateMilestone: (mid: string, b: IMilestoneRequest) => send<void>('PUT', `${base}/milestones/${mid}`, b),
  deleteMilestone: (mid: string) => send<void>('DELETE', `${base}/milestones/${mid}`),
  acceptMilestone: (mid: string, acceptedOn: string, note: string | null) => httpPost<void>(`${base}/milestones/${mid}/accept`, { acceptedOn, note }),
  tasks: (id: string) => http<ITask[]>(`${base}/${id}/tasks`),
  myTasks: () => http<ITask[]>(`${base}/tasks/mine`),
  createTask: (id: string, b: ITaskRequest) => httpPost<string>(`${base}/${id}/tasks`, b),
  updateTask: (tid: string, b: ITaskRequest) => send<void>('PUT', `${base}/tasks/${tid}`, b),
  moveTask: (tid: string, state: TaskState, rank?: number) => httpPost<void>(`${base}/tasks/${tid}/move`, { state, rank }),
  deleteTask: (tid: string) => send<void>('DELETE', `${base}/tasks/${tid}`),
  comments: (tid: string) => http<IComment[]>(`${base}/tasks/${tid}/comments`),
  addComment: (tid: string, content: string) => httpPost<string>(`${base}/tasks/${tid}/comments`, { content }),
};
