// Khớp với DTO ở backend/src/Modules/Leave/.../Features/LeaveEndpoints.cs, Infrastructure/LeaveServices.cs

export type LeavePeriod = 'FullDay' | 'Morning' | 'Afternoon';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface ILeaveType {
  id: string;
  code: 'annual' | 'sick' | 'personal_paid' | 'unpaid' | string;
  name: string;
  isPaid: boolean;
  usesAnnualBalance: boolean;
}

export interface IBalance {
  year: number;
  entitlementThisYear: number;
  accruedThisYear: number;
  carriedFromPreviousYears: number;
  adjustedThisYear: number;
  usedThisYear: number;
  pending: number;
  available: number;
}

export interface IEmployeeBrief {
  id: string;
  code: string;
  fullName: string;
  departmentName: string | null;
}

export interface ILeaveRequest {
  id: string;
  employee: IEmployeeBrief;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  period: LeavePeriod;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  rejectReason: string | null;
  approvalRequestId: string | null;
  createdAt: string;
}

export interface ICreateLeave {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  period: LeavePeriod;
  reason?: string;
}

export interface IPreview {
  days: number;
  workingDays: string[];
}

export interface IEmployeeBalance {
  employee: IEmployeeBrief;
  balance: IBalance;
}

export interface IAdjustment {
  id: string;
  employeeId: string;
  days: number;
  reason: string;
  createdAt: string;
  createdByName: string | null;
}
