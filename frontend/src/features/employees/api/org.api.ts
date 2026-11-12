import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  IBulkUpdateEmployees,
  IMyFinanceAccess,
  AccountMode, IAccountCreated, IDepartment, IEmployee, IEmployeeDetail, IEmployeeFilter, IPosition,
  IImportPreview, IImportResult, IUpsertDepartment, IUpsertEmployee, IUpsertPosition,
  IDepartmentDetail, IGuide, IMyRole, IPositionDetail,
} from '../types/employee.types';

const put = <T>(url: string, body: unknown) => http<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const del = (url: string) => http<void>(url, { method: 'DELETE' });

export const orgKeys = {
  all: ['org'] as const,
  employees: (f: IEmployeeFilter = {}) => ['org', 'employees', f] as const,
  employeesPage: (f: IEmployeeFilter, q: IPageQuery) => ['org', 'employees', 'page', f, q] as const,
  employee: (id: string) => ['org', 'employee', id] as const,
  myProfile: ['org', 'employee', 'me'] as const,
  departments: ['org', 'departments'] as const,
  positions: ['org', 'positions'] as const,
  department: (id: string) => ['org', 'departments', id] as const,
  position: (id: string) => ['org', 'positions', id] as const,
  myRole: ['org', 'my-role'] as const,
  guideTemplates: ['org', 'guide-templates'] as const,
};

const employeeParams = (f: IEmployeeFilter) => {
  const q = new URLSearchParams();
  if (f.search) q.set('search', f.search);
  if (f.departmentId) q.set('departmentId', f.departmentId);
  if (f.includeResigned) q.set('includeResigned', 'true');
  if (f.onlyResigned) q.set('status', 'Resigned');
  return q;
};

export const employeesApi = {
  /** Cả danh sách (chọn nhân viên trong form, sơ đồ tổ chức). */
  list: (f: IEmployeeFilter = {}) => http<IEmployee[]>(`/api/org/employees?${employeeParams(f)}`),
  /** Một trang (danh bạ) — BE lọc + cắt trang. */
  listPage: (f: IEmployeeFilter, q: IPageQuery) => http<IPaged<IEmployee>>(`/api/org/employees?${employeeParams(f)}&${pageQs(q)}`),
  get: (id: string) => http<IEmployeeDetail>(`/api/org/employees/${id}`),
  me: () => http<IEmployeeDetail>('/api/org/employees/me'),
  nextCode: () => http<{ code: string }>('/api/org/employees/next-code'),
  create: (body: IUpsertEmployee) => httpPost<IEmployeeDetail>('/api/org/employees', body),
  update: (id: string, body: IUpsertEmployee) => put<IEmployeeDetail>(`/api/org/employees/${id}`, body),
  resign: (id: string, leftAt: string) => httpPost<void>(`/api/org/employees/${id}/resign`, { leftAt }),
  reactivate: (id: string) => httpPost<void>(`/api/org/employees/${id}/reactivate`),
  // Thao tác hàng loạt (HR)
  bulkUpdate: (body: IBulkUpdateEmployees) => httpPost<{ affected: number }>('/api/org/employees/bulk/update', body),
  bulkResign: (ids: string[], leftAt: string) => httpPost<{ affected: number }>('/api/org/employees/bulk/resign', { ids, leftAt }),
  /** Excel: theo danh sách id đã chọn, hoặc (không truyền ids) mọi người khớp bộ lọc. */
  exportUrl: (sel: { ids: string[] } | { filter: IEmployeeFilter }) =>
    `/api/org/employees/export?${'ids' in sel ? `ids=${sel.ids.join(',')}` : employeeParams(sel.filter)}`,
  // Tài khoản đăng nhập
  createAccount: (id: string, mode: AccountMode, roles: string[], userName?: string) =>
    httpPost<IAccountCreated>(`/api/org/employees/${id}/account`, { mode, roles, userName: userName || null }),
  resendInvite: (id: string) => httpPost<void>(`/api/org/employees/${id}/account/resend-invite`),
  resetPassword: (id: string) => httpPost<{ tempPassword: string }>(`/api/org/employees/${id}/account/reset-password`),
  /** Nhân viên mất điện thoại: tắt 2FA + đăng xuất mọi phiên (admin / HR sẽ bị buộc bật lại). */
  resetTwoFactor: (id: string) => httpPost<void>(`/api/org/employees/${id}/account/reset-2fa`),
  /** Đánh dấu tài khoản do bot / agent AI vận hành → bot hiện trong văn phòng 3D khi gọi MCP (không đổi quyền). */
  setBot: (id: string, isBot: boolean) => put<void>(`/api/org/employees/${id}/account/bot`, { isBot }),
  /** Chỉ admin; trống = xoá. */
  setTelegramBot: (id: string, telegramBot: string | null) => put<void>(`/api/org/employees/${id}/account/telegram`, { telegramBot }),
  setRoles: (id: string, roles: string[]) => put<void>(`/api/org/employees/${id}/account/roles`, { roles }),
  // Nhập từ Excel (HR)
  importTemplateUrl: '/api/org/employees/import-template',
  importPreview: (file: File) => uploadForm<IImportPreview>('/api/org/employees/import/preview', file),
  importCommit: (file: File) => uploadForm<IImportResult>('/api/org/employees/import', file),
};

function uploadForm<T>(url: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  return http<T>(url, { method: 'POST', body: form });
}

export const departmentsApi = {
  list: () => http<IDepartment[]>('/api/org/departments'),
  create: (body: IUpsertDepartment) => httpPost<string>('/api/org/departments', body),
  update: (id: string, body: IUpsertDepartment) => put<void>(`/api/org/departments/${id}`, body),
  remove: (id: string) => del(`/api/org/departments/${id}`),
};

export const positionsApi = {
  list: () => http<IPosition[]>('/api/org/positions'),
  create: (body: IUpsertPosition) => httpPost<string>('/api/org/positions', body),
  update: (id: string, body: IUpsertPosition) => put<void>(`/api/org/positions/${id}`, body),
  remove: (id: string) => del(`/api/org/positions/${id}`),
  myFinance: () => http<IMyFinanceAccess>('/api/org/positions/my-finance'),
};

/** Mô tả + hướng dẫn (đọc: mọi người; sửa phòng ban: HR / trưởng phòng đó; sửa chức vụ: HR). */
export const guidesApi = {
  department: (id: string) => http<IDepartmentDetail>(`/api/org/departments/${id}`),
  position: (id: string) => http<IPositionDetail>(`/api/org/positions/${id}`),
  saveDepartment: (id: string, body: { description: string | null; guide: string | null }) => put<IGuide>(`/api/org/departments/${id}/guide`, body),
  savePosition: (id: string, body: { description: string | null; guide: string | null }) => put<IGuide>(`/api/org/positions/${id}/guide`, body),
  myRole: () => http<IMyRole>('/api/org/employees/me/role'),
  templates: () => http<{ department: string; position: string }>('/api/org/guide-templates'),
};
