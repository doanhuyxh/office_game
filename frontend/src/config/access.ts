import { PATHS } from './paths';
import { ROLE, type Role } from './roles';

/**
 * Trang chỉ dành cho một số vai trò — NGUỒN DUY NHẤT cho cả menu sidebar / ⌘K (`useNavigation`) và chặn route (`page(...)` trong
 * routes/router.tsx → `RoleGate`). Trang không có ở đây: ai đăng nhập cũng vào được (nội dung bên trong vẫn lọc theo vai trò).
 * Đây chỉ là lớp giao diện — quyền thật luôn kiểm tra ở back-end (`AuthPolicies`).
 */
export const PAGE_ROLES: Partial<Record<string, readonly Role[]>> = {
  [PATHS.payroll]: [ROLE.admin, ROLE.hr],
  [PATHS.reports]: [ROLE.admin, ROLE.hr],
  [PATHS.audit]: [ROLE.admin, ROLE.hr],
  [PATHS.system]: [ROLE.admin],
};

/** Người dùng (danh sách vai trò) có vào được trang `path` không. */
export const canAccessPage = (roles: readonly string[] | null | undefined, path: string) => {
  const need = PAGE_ROLES[path];
  return !need || (!!roles && need.some((r) => roles.includes(r)));
};
