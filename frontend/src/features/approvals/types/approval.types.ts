// Khớp với DTO ở backend/src/Modules/Approval/.../Features/ApprovalEndpoints.cs

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type StepStatus = 'Waiting' | 'Pending' | 'Approved' | 'Rejected';
export type ApprovalType = 'leave' | 'attendance_correction' | 'overtime' | 'document_publish';

export interface IPersonBrief {
  id: string;
  code: string;
  fullName: string;
  departmentName: string | null;
}

export interface IApprovalStep {
  order: number;
  kind: 'Manager' | 'Hr';
  approverName: string | null;
  status: StepStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
  /** Có = người quyết định đã duyệt thay người quản lý này (uỷ quyền). */
  onBehalfOfName: string | null;
}

export interface IApproval {
  id: string;
  type: ApprovalType | string;
  subjectId: string;
  title: string;
  summary: string;
  status: ApprovalStatus;
  requester: IPersonBrief;
  createdAt: string;
  decidedAt: string | null;
  steps: IApprovalStep[];
  canDecide: boolean;
  canCancel: boolean;
  /** Có = tôi chỉ được quyết định với tư cách người được uỷ quyền của người quản lý này ("duyệt thay"). */
  decideOnBehalfOfName: string | null;
}

export type DelegationStatus = 'Upcoming' | 'Active' | 'Expired' | 'Revoked';

/** Khớp DelegationDto (Features/DelegationEndpoints.cs). Ngày yyyy-MM-dd (lịch VN), thời điểm UTC. */
export interface IDelegation {
  id: string;
  delegator: IPersonBrief;
  delegate: IPersonBrief;
  fromDate: string;
  toDate: string;
  note: string | null;
  status: DelegationStatus;
  createdAt: string;
  createdByName: string;
  revokedAt: string | null;
  revokedByName: string | null;
  canRevoke: boolean;
}

export interface IMyDelegations {
  /** Hồ sơ nhân viên của tôi (null = tài khoản không có hồ sơ). */
  employeeId: string | null;
  /** Tôi có cấp dưới → được tự uỷ quyền. */
  canDelegate: boolean;
  given: IDelegation[];
  received: IDelegation[];
}

export interface ICreateDelegation {
  /** null = chính tôi; người khác → chỉ HR. */
  delegatorEmployeeId: string | null;
  delegateEmployeeId: string;
  fromDate: string;
  toDate: string;
  note: string | null;
}
