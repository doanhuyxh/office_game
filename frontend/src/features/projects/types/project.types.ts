/** Khớp DTO module Projects. Không có số tiền (quản lý dự án chỉ xem ngày công). */
export type ProjectKind = 'Internal' | 'Client';
export type ProjectStatus = 'Active' | 'Closed';
export type MemberRole = 'Member' | 'Manager';
export type MilestoneStatus = 'Open' | 'Accepted';
export type TaskState = 'Todo' | 'Doing' | 'Review' | 'Done';

export interface ISalesContractRef { id: string; code: string; title: string; customerName: string; status: string; businessLineId: string | null }
export interface IInstallmentRef { id: string; contractId: string; title: string; dueOn: string; cancelled: boolean }
export interface IMember { employeeId: string; code: string | null; fullName: string; jobTitle: string | null; role: MemberRole; isActive: boolean }
export interface IProject {
  id: string; code: string; name: string; description: string | null; kind: ProjectKind; status: ProjectStatus; departmentId: string | null; departmentName: string | null;
  businessLineId: string | null; contract: ISalesContractRef | null; startOn: string | null; endOn: string | null; budgetManDays: number | null; myRole: MemberRole | null;
  canManage: boolean; canWork: boolean; memberCount: number; tasks: { open: number; done: number; overdue: number }; milestonesOpen: number; milestonesAccepted: number; createdAt: string;
}
export interface IMilestone {
  id: string; order: number; title: string; dueOn: string | null; status: MilestoneStatus; installmentId: string | null; installmentTitle: string | null;
  installmentDueOn: string | null; acceptedOn: string | null; acceptedByName: string | null; note: string | null; tasksOpen: number; tasksDone: number;
}
export interface IProjectDetail { project: IProject; members: IMember[]; milestones: IMilestone[] }
export interface ITask {
  id: string; projectId: string; code: string; title: string; description: string | null; state: TaskState; rank: number; assigneeEmployeeId: string | null;
  assigneeName: string | null; milestoneId: string | null; dueOn: string | null; estimateDays: number | null; overdue: boolean; commentCount: number; createdAt: string;
  createdByName: string; completedAt: string | null; projectName: string | null;
}
export interface IComment { id: string; content: string; authorName: string; createdAt: string }
export interface IEffortCell { employeeId: string; month: string; presentDays: number; percent: number; explicit: boolean; manDays: number }
export interface IEffort { months: string[]; members: IMember[]; cells: IEffortCell[]; totalManDays: number; budgetManDays: number | null }

export interface IProjectRequest {
  code: string; name: string; kind: ProjectKind; description?: string | null; departmentId?: string | null; businessLineId?: string | null; salesContractId?: string | null;
  startOn?: string | null; endOn?: string | null; budgetManDays?: number | null; status?: ProjectStatus; memberIds?: string[];
}
export interface ITaskRequest {
  title: string; description?: string | null; state: TaskState; assigneeEmployeeId?: string | null; milestoneId?: string | null; dueOn?: string | null; estimateDays?: number | null;
}
export interface IMilestoneRequest { title: string; dueOn?: string | null; installmentId?: string | null; note?: string | null }
