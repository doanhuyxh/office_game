// Khớp với DTO ở backend/src/Modules/Approval/.../Features/ApprovalEndpoints.cs

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
export type StepStatus = 'Waiting' | 'Pending' | 'Approved' | 'Rejected';
export type ApprovalType = 'leave' | 'attendance_correction' | 'overtime';

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
}
