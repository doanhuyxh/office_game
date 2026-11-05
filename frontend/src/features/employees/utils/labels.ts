import type { EmployeeStatus } from '../types/employee.types';

export const STATUS_LABEL: Record<EmployeeStatus, string> = {
  Probation: 'Thử việc',
  Active: 'Chính thức',
  Resigned: 'Đã nghỉ việc',
};

export const STATUS_VARIANT: Record<EmployeeStatus, 'default' | 'secondary' | 'outline'> = {
  Probation: 'secondary',
  Active: 'default',
  Resigned: 'outline',
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Quản trị hệ thống',
  hr: 'Nhân sự (HR)',
  manager: 'Quản lý',
  employee: 'Nhân viên',
};

/** Vai trò HR được cấp (admin chỉ admin cấp). "employee" luôn có. */
export const GRANTABLE_ROLES = ['manager', 'hr', 'admin'] as const;

export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); // yyyy-MM-dd
