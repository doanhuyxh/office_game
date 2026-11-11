/** Khớp DTO module Projects. Số tiền chỉ có ở IProjectFinancials (quyền Xem tài chính) — quản lý dự án chỉ xem ngày công. */
export type ProjectKind = 'Internal' | 'Client';
export type ProjectStatus = 'Active' | 'Closed';
export type MemberRole = 'Member' | 'Manager';
export type MilestoneStatus = 'Open' | 'Accepted';
/** Cột trạng thái công việc của một dự án (tên / màu / thứ tự tự do). isDone = cột hoàn thành; approverOnly = chỉ quản lý dự án chuyển vào / kéo lùi ra. */
export interface ITaskColumn { id: string; name: string; position: number; color: string; isDone: boolean; approverOnly: boolean; taskCount: number }
export interface ITaskColumnRequest { name: string; color?: string | null; isDone: boolean; approverOnly: boolean }

export interface ISalesContractRef { id: string; code: string; title: string; customerName: string; status: string; businessLineId: string | null }
export interface IInstallmentRef { id: string; contractId: string; title: string; dueOn: string; cancelled: boolean }
export interface IMember { employeeId: string; code: string | null; fullName: string; jobTitle: string | null; role: MemberRole; isActive: boolean }
export interface IProject {
  id: string; code: string; name: string; description: string | null; kind: ProjectKind; status: ProjectStatus; departmentId: string | null; departmentName: string | null;
  businessLineId: string | null; contracts: ISalesContractRef[]; startOn: string | null; endOn: string | null; budgetManDays: number | null; myRole: MemberRole | null;
  canManage: boolean; canWork: boolean; memberCount: number; tasks: { open: number; done: number; overdue: number }; milestonesOpen: number; milestonesAccepted: number; createdAt: string;
  progress: IProjectProgress;
  /** "Đi lần lượt": tiến từng cột một, lùi phải ghi lý do (back-end kiểm). */
  sequential: boolean;
  /** Chức vụ có quyền "Quản lý trạng thái công việc" (thêm / sửa / sắp xếp / xoá cột). */
  canManageColumns: boolean;
}
export type ProjectHealth = 'OnTrack' | 'AtRisk' | 'Late';
/** Tiến độ do back-end tính (ProgressRules); health = null khi dự án đã đóng. */
export interface IProjectProgress {
  total: number; done: number; overdue: number; percentDone: number | null; timeElapsedPercent: number | null;
  nextMilestone: { title: string; dueOn: string | null; overdue: boolean } | null; milestonesOverdue: number; health: ProjectHealth | null; healthReasons: string[];
}
export interface IMilestone {
  id: string; order: number; title: string; dueOn: string | null; status: MilestoneStatus; installmentId: string | null; installmentTitle: string | null;
  installmentDueOn: string | null; acceptedOn: string | null; acceptedByName: string | null; note: string | null; tasksOpen: number; tasksDone: number;
}
/** workGuide: hướng dẫn làm việc (Markdown) do quản lý dự án soạn — người và BOT đọc trước khi làm. */
export interface IProjectDetail { project: IProject; members: IMember[]; milestones: IMilestone[]; workGuide: string | null; columns: ITaskColumn[] }
export interface ITask {
  id: string; projectId: string; code: string; title: string; description: string | null; columnId: string; columnName: string; columnColor: string;
  /** Đang ở cột hoàn thành. */
  done: boolean; rank: number; assigneeEmployeeId: string | null;
  assigneeName: string | null; milestoneId: string | null; dueOn: string | null; estimateDays: number | null; overdue: boolean; commentCount: number; createdAt: string;
  createdByName: string; completedAt: string | null; projectName: string | null;
  /** Tạo qua token AI / MCP. */
  createdByBot: boolean;
  /** Link ảnh / video (http/https). */
  mediaLinks: string[];
}
export interface IComment { id: string; content: string; authorName: string; createdAt: string; byBot: boolean }
export type TaskActivityKind = 'Created' | 'Moved' | 'Assigned' | 'DueChanged' | 'Edited';
export interface ITaskActivity { id: string; kind: TaskActivityKind; from: string | null; to: string | null; note: string | null; actorName: string; byBot: boolean; at: string }
/** GET /tasks/{id}: việc + bình luận + lịch sử. canApprove = được chuyển vào / kéo lùi ra cột cần người duyệt. */
export interface ITaskDetail { task: ITask; comments: IComment[]; activities: ITaskActivity[]; sequential: boolean; canApprove: boolean; columns: ITaskColumn[] }
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
  sequential?: boolean; workGuide?: string | null;
}
export interface ITaskRequest {
  title: string; description?: string | null; columnId?: string | null; assigneeEmployeeId?: string | null; milestoneId?: string | null; dueOn?: string | null; estimateDays?: number | null;
  mediaLinks?: string[];
  /** Lý do khi chuyển lùi trạng thái (bắt buộc nếu dự án đi lần lượt). */
  note?: string | null;
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
