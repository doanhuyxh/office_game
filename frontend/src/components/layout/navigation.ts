import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bot, Building2, CalendarClock, CheckSquare, Clock, FileText, History, Landmark, LayoutDashboard, Palmtree, Users, Wallet } from 'lucide-react';
import { PATHS } from '@/config/paths';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}
// Vai trò được thấy mục nào: theo PAGE_ROLES (config/access.ts) — cùng nguồn với chặn route.

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Menu sidebar (nhóm → mục). Cũng dùng cho hộp tìm nhanh Ctrl/⌘ + K.
 * Thêm màn hình mới: tạo features/<x>, thêm route trong routes/router.tsx, rồi thêm dòng ở đây.
 */
export const NAVIGATION: NavGroup[] = [
  {
    title: 'Chung',
    items: [
      { to: PATHS.dashboard, label: 'Tổng quan', icon: LayoutDashboard },
      { to: PATHS.office, label: 'Văn phòng 3D', icon: Building2 },
      { to: PATHS.aiAccess, label: 'Kết nối AI', icon: Bot },
    ],
  },
  {
    title: 'Công việc',
    items: [
      { to: PATHS.attendance, label: 'Chấm công', icon: Clock },
      { to: PATHS.leave, label: 'Nghỉ phép', icon: Palmtree },
      { to: PATHS.approvals, label: 'Phê duyệt', icon: CheckSquare },
      { to: PATHS.meetings, label: 'Phòng họp', icon: CalendarClock },
      { to: PATHS.payslips, label: 'Phiếu lương', icon: Wallet },
    ],
  },
  {
    title: 'Tổ chức',
    items: [
      { to: PATHS.employees, label: 'Nhân viên', icon: Users },
      { to: PATHS.contracts, label: 'Hợp đồng', icon: FileText }, // HR: tất cả; nhân viên: của mình (quyền kiểm tra ở back-end)
      { to: PATHS.payroll, label: 'Bảng lương', icon: Landmark },
      { to: PATHS.reports, label: 'Báo cáo', icon: BarChart3 },
      { to: PATHS.audit, label: 'Lịch sử thay đổi', icon: History },
    ],
  },
];
