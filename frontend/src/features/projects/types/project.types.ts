/** Khớp DTO module Projects. Số tiền chỉ có ở IProjectFinancials (quyền Xem tài chính) — quản lý dự án chỉ xem ngày công. */
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
  businessLineId: string | null; contracts: ISalesContractRef[]; startOn: string | null; endOn: string | null; budgetManDays: number | null; myRole: MemberRole | null;
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
  /** Link ảnh / video (http/https). */
  mediaLinks: string[];
}
export interface IComment { id: string; content: string; authorName: string; createdAt: string }
export interface IEffortCell { employeeId: string; month: string; presentDays: number; percent: number; explicit: boolean; manDays: number }
export interface IEffort {
  months: string[]; members: IMember[]; cells: IEffortCell[]; totalManDays: number; budgetManDays: number | null;
  /** Tháng đã chốt phân bổ — chỉ HR / Quản trị tài chính sửa (canEditFrozen). */
  frozenMonths: string[]; canEditFrozen: boolean;
}

export interface IContractMoney {
  id: string; code: string; title: string; customerName: string; status: string; valueBeforeTax: number; vatRate: number; totalValue: number; collected: number; outstanding: number;
}
export interface IMonthMoney { month: string; manDays: number; labor: number; laborEstimated: boolean; directExpense: number; otherIncome: number; collected: number }
export interface ICategoryMoney { name: string; isIncome: boolean; amount: number }
export interface IPersonMoney { employeeId: string; fullName: string; manDays: number; labor: number }
/** Lãi / lỗ dự án (chỉ quyền Xem tài chính). Doanh thu = giá trị HĐ sau thuế, VAT là chi phí. people: chỉ Quản trị tài chính. */
export interface IProjectFinancials {
  projectId: string; code: string; name: string; status: ProjectStatus; kind: ProjectKind; revenue: number; vat: number; otherIncome: number; labor: number;
  directExpense: number; profit: number; marginPercent: number | null; collected: number; outstanding: number; manDays: number; budgetManDays: number | null;
  hasEstimate: boolean; contracts: IContractMoney[]; months: IMonthMoney[]; categories: ICategoryMoney[]; people: IPersonMoney[] | null;
}

export interface IProjectRequest {
  code: string; name: string; kind: ProjectKind; description?: string | null; departmentId?: string | null; businessLineId?: string | null; salesContractIds?: string[];
  startOn?: string | null; endOn?: string | null; budgetManDays?: number | null; status?: ProjectStatus; memberIds?: string[];
}
export interface ITaskRequest {
  title: string; description?: string | null; state: TaskState; assigneeEmployeeId?: string | null; milestoneId?: string | null; dueOn?: string | null; estimateDays?: number | null;
  mediaLinks?: string[];
}
export interface IMilestoneRequest { title: string; dueOn?: string | null; installmentId?: string | null; note?: string | null }

export type ChangeRequestStatus = 'Draft' | 'Sent' | 'Approved' | 'Rejected' | 'Cancelled';
/** Yêu cầu thay đổi (CR) — không có tiền; appendix = phụ lục hợp đồng bán đã lập từ CR. */
export interface IChangeRequest {
  id: string; number: number; code: string; title: string; description: string | null; estimateManDays: number | null; billable: boolean; status: ChangeRequestStatus;
  sentOn: string | null; decidedOn: string | null; decidedByName: string | null; decisionNote: string | null; budgetAddedManDays: number | null; createdAt: string; createdByName: string;
  appendix: { id: string; code: string; contractId: string; contractCode: string; signedOn: string } | null;
}
export interface IChangeRequestRequest { title: string; description?: string | null; estimateManDays?: number | null; billable: boolean }
