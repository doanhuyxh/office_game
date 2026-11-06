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
  /** Cấp bậc của chức vụ (1 = cao nhất) */
  positionLevel: number | null;
  /** Chức danh — công việc cụ thể (Lễ tân, Lập trình viên…) */
  jobTitle: string | null;
  managerId: string | null;
  managerName: string | null;
  /** Thông tin nhân sự: null nếu người xem không phải HR / chính chủ / quản lý của người này (BE ẩn). */
  status: EmployeeStatus | null;
  joinedAt: string | null; // yyyy-MM-dd
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
  jobTitle?: string | null;
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
  description: string | null;
  hasGuide: boolean;
}

export interface IUpsertDepartment {
  name: string;
  code?: string | null;
  parentId?: string | null;
  headEmployeeId?: string | null;
  mapZone?: string | null;
  sortOrder?: number;
}

/** Chức vụ = cấp bậc. level 1 = cao nhất; nhiều chức vụ có thể cùng cấp. */
export interface IPosition {
  id: string;
  name: string;
  level: number;
  sortOrder: number;
  employeeCount: number;
  description: string | null;
  hasGuide: boolean;
}

export interface IUpsertPosition {
  name: string;
  level: number;
  sortOrder?: number;
}

/** Một dòng xem trước khi nhập Excel (ImportRowDto). row = số dòng trong file. */
export interface IImportRow {
  row: number;
  code: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  departmentName: string | null;
  positionName: string | null;
  jobTitle: string | null;
  managerCode: string | null;
  managerName: string | null;
  joinedAt: string | null;
  status: string;
  errors: string[];
}

export interface IImportPreview {
  rows: IImportRow[];
  validCount: number;
  errorCount: number;
  fileError: string | null;
}

export interface IImportResult {
  created: number;
  codes: string[];
}

/** Mô tả + hướng dẫn phòng ban / chức vụ — mọi nhân viên và trợ lý AI (MCP) đọc được. */
export interface IGuide {
  description: string | null;
  guide: string | null;
  guideUpdatedAt: string | null;
  guideUpdatedByName: string | null;
}
export interface IDepartmentDetail {
  id: string; name: string; code: string | null; parentId: string | null; parentName: string | null;
  headEmployeeId: string | null; headName: string | null; employeeCount: number; guide: IGuide; canEditGuide: boolean;
}
export interface IPositionDetail { id: string; name: string; level: number; employeeCount: number; guide: IGuide; canEditGuide: boolean }
export interface IRolePerson { id: string; code: string; fullName: string; jobTitle: string | null; positionName: string | null }
export interface IRoleDepartment { id: string; name: string; code: string | null; headName: string | null; isHead: boolean; description: string | null; guide: string | null }
export interface IRolePosition { id: string; name: string; level: number; description: string | null; guide: string | null }
/** Vai trò của tôi — cùng nội dung tool MCP get_my_role trả cho trợ lý AI. departments: phòng mình trước, rồi phòng cha. */
export interface IMyRole { me: IRolePerson; position: IRolePosition | null; departments: IRoleDepartment[]; manager: IRolePerson | null; headOf: string[] }
