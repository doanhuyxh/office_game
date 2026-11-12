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
/** avatarUrl / isBot: gợi ý @nhắc trong bình luận việc (TEST-62). */
export interface IMember { employeeId: string; code: string | null; fullName: string; jobTitle: string | null; role: MemberRole; isActive: boolean; avatarUrl?: string | null; isBot?: boolean }
/** Phòng ban tham gia dự án (TEST-40); isLead = phòng chủ trì (đứng đầu danh sách). */
export interface IProjectDepartment { id: string; name: string; isLead: boolean }
export interface IProject {
  id: string; code: string; name: string; description: string | null; kind: ProjectKind; status: ProjectStatus; departments: IProjectDepartment[];
  /** Chỉ thấy dự án nhờ phòng ban của mình tham gia → chỉ đọc. */
  viaDepartment: boolean;
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
/** Khoá quyền trong dự án (back-end sinh từ ProjectViewer). */
export type ProjectAccess = 'view' | 'work' | 'manage' | 'columns' | 'effort' | 'finance' | 'documents';
/** myAccess: quyền của người xem trong dự án. */
export interface IProjectDetail { project: IProject; members: IMember[]; milestones: IMilestone[]; workGuide: string | null; columns: ITaskColumn[]; myAccess: ProjectAccess[] }
/** Tab Phụ lục: quyền theo vai trò (personas) + phòng ban + thành viên. */
export interface IProjectAppendix {
  capabilities: { key: ProjectAccess; label: string }[];
  personas: { key: 'manager' | 'member' | 'department' | 'hr' | 'finance' | 'columns'; label: string; who: string; allowed: ProjectAccess[] }[];
  departments: { id: string; name: string; isLead: boolean; employeeCount: number }[];
  members: { employeeId: string; code: string | null; fullName: string; departmentName: string | null; role: MemberRole; isBot: boolean; isActive: boolean }[];
}
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
  /** Số việc phải chờ chưa xong (0 = bắt đầu được). */
  waitingOn?: number;
}
/** Việc liên quan (phải chờ / đang chặn). */
export interface ITaskRef { id: string; code: string; title: string; done: boolean }
/** canDelete: back-end tính theo người xem — chỉ chính người viết, trên web, dự án đang chạy. */
export interface IComment { id: string; content: string; authorName: string; createdAt: string; byBot: boolean; canDelete: boolean }
export type TaskActivityKind = 'Created' | 'Moved' | 'Assigned' | 'DueChanged' | 'Edited' | 'Depends' | 'CommentDeleted';
export interface ITaskActivity { id: string; kind: TaskActivityKind; from: string | null; to: string | null; note: string | null; actorName: string; byBot: boolean; at: string }
/** GET /tasks/{id}: việc + bình luận + lịch sử. canApprove = được chuyển vào / kéo lùi ra cột cần người duyệt. */
export interface ITaskDetail { task: ITask; comments: IComment[]; activities: ITaskActivity[]; sequential: boolean; canApprove: boolean; columns: ITaskColumn[];
  /** Việc phải xong trước / việc đang chờ việc này. */
  dependsOn?: ITaskRef[]; blocks?: ITaskRef[] }
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
  code: string; name: string; kind: ProjectKind; description?: string | null; departmentIds?: string[]; leadDepartmentId?: string | null; businessLineId?: string | null; salesContractIds?: string[];
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

/** Một thay đổi ở dự án (GET /api/projects/activity) — bảng việc tự cập nhật + toast khi đang ở trang khác. */
export interface IProjectActivity {
  id: string; projectId: string; projectName: string; taskId: string; taskCode: string; taskTitle: string;
  kind: 'Created' | 'Moved' | 'Assigned' | 'DueChanged' | 'Edited' | 'Depends' | 'CommentDeleted' | 'Commented';
  from: string | null; to: string | null; text: string | null; actorName: string; byBot: boolean; at: string;
  /** Người xem là thành viên dự án — chỉ hiện toast cho dự án mình tham gia. */
  member: boolean;
}
export interface IProjectActivityFeed { cursor: string; items: IProjectActivity[] }

/** Giới hạn đội agent (trang Hệ thống, chỉ admin): việc / ngày qua token AI, số lần bot liên tiếp trên một việc. isDefault = chưa ai chỉnh. */
export interface IAgentSettings {
  maxBotTasksPerDay: number; maxBotStreak: number; isDefault: boolean; updatedAt: string | null; updatedByName: string | null;
  defaultTasksPerDay: number; defaultStreak: number; tasksPerDayMin: number; tasksPerDayMax: number; streakMin: number; streakMax: number;
}
export interface IAgentSettingsRequest { maxBotTasksPerDay: number; maxBotStreak: number }
