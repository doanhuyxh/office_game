import { canAccessPage } from '@/config/access';
import { useMe } from '@/features/auth';
import { NAVIGATION, type NavGroup } from './navigation';

/** Menu đã lọc theo vai trò (PAGE_ROLES — chỉ để hiển thị, quyền thật kiểm tra ở back-end). Bỏ nhóm rỗng. */
export function useNavigation(): NavGroup[] {
  const { data: me } = useMe();
  return NAVIGATION.map((g) => ({ ...g, items: g.items.filter((n) => canAccessPage(me?.roles, n.to)) })).filter((g) => g.items.length > 0);
}

/** "Nguyễn Văn An" → "NA" (avatar chữ). */
export const initials = (name?: string | null) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts.length > 1 ? parts[0][0] : '') + parts[parts.length - 1][0]).toUpperCase();
};
