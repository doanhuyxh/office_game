// Khớp với DTO ở backend/src/Modules/Organization/.../Features/*

export type EmployeeStatus = 'Probation' | 'Active' | 'Resigned';

export interface IAccountSummary {
  userName: string;
  roles: string[];
  isActive: boolean;
  mustChangePassword: boolean;
  invitePending: boolean;
  lastLoginAt: string | null;
}

export interface IEmployee {
  id: string;
  code: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  departmentId: string | null;
  departmentName: string | null;
  positionId: string | null;
  positionName: string | null;
  managerId: string | null;
  managerName: string | null;
  status: EmployeeStatus;
  joinedAt: string; // yyyy-MM-dd
  leftAt: string | null;
  userId: string | null;
  /** Chỉ HR (hoặc chính chủ) nhận được */
  account: IAccountSummary | null;
}

export interface IEmployeeDetail {
  employee: IEmployee;
  dateOfBirth: string | null;
  note: string | null;
  subordinateCount: number;
}

export interface IUpsertEmployee {
  code?: string | null;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  dateOfBirth?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  managerId?: string | null;
  status?: EmployeeStatus | null;
  joinedAt: string;
  note?: string | null;
}

export interface IEmployeeFilter {
  search?: string;
  departmentId?: string;
  includeResigned?: boolean;
}

export type AccountMode = 'invite' | 'password';

export interface IAccountCreated {
  userId: string;
  userName: string;
  tempPassword: string | null;
  inviteSent: boolean;
}

export interface IDepartment {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  headEmployeeId: string | null;
  headName: string | null;
  mapZone: string | null;
  sortOrder: number;
  employeeCount: number;
}

export interface IUpsertDepartment {
  name: string;
  code?: string | null;
  parentId?: string | null;
  headEmployeeId?: string | null;
  mapZone?: string | null;
  sortOrder?: number;
}

export interface IPosition {
  id: string;
  name: string;
  sortOrder: number;
  employeeCount: number;
}

export interface IUpsertPosition {
  name: string;
  sortOrder?: number;
}
