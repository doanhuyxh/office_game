import { PATHS } from '@/config/paths';
import { ROLE, type Role } from '@/config/roles';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Để trống = ai cũng thấy */
  roles?: Role[];
}

/** Menu sidebar. Thêm màn hình mới: tạo features/<x>, thêm route trong routes/router.tsx, rồi thêm dòng ở đây. */
export const NAVIGATION: NavItem[] = [
  { to: PATHS.dashboard, label: 'Tổng quan', icon: '🏠' },
  { to: PATHS.attendance, label: 'Chấm công', icon: '🕘' },
  { to: PATHS.leave, label: 'Nghỉ phép', icon: '🌴' },
  { to: PATHS.approvals, label: 'Phê duyệt', icon: '✅', roles: [ROLE.admin, ROLE.hr, ROLE.manager] },
  { to: PATHS.employees, label: 'Nhân viên', icon: '👥' },
  { to: PATHS.contracts, label: 'Hợp đồng', icon: '📄', roles: [ROLE.admin, ROLE.hr] },
  { to: PATHS.reports, label: 'Báo cáo', icon: '📊', roles: [ROLE.admin, ROLE.hr] },
];
