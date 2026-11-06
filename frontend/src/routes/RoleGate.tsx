import type { ReactNode } from 'react';
import { Forbidden } from '@/components/feedback/Forbidden';
import { canAccessPage } from '@/config/access';
import { useMe } from '@/features/auth';

/** Bọc trang theo `PAGE_ROLES`: không đủ vai trò → trang "không có quyền" (không tải chunk của trang, không gọi API của nó). */
export function RoleGate({ path, children }: { path: string; children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return null; // protectedRoute đã nạp `me` trước khi render — nhánh này chỉ là phòng hờ
  return canAccessPage(me.roles, path) ? children : <Forbidden />;
}
