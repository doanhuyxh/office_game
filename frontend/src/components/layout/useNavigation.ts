import { canAccessPage } from '@/config/access';
import { PATHS } from '@/config/paths';
import { useMe } from '@/features/auth';
import { useMyProfile } from '@/features/profile';
import { NAVIGATION, type NavGroup } from './navigation';

/**
 * Menu đã lọc theo vai trò (PAGE_ROLES — chỉ để hiển thị, quyền thật kiểm tra ở back-end). Bỏ nhóm rỗng.
 * "Hồ sơ cá nhân" ẩn với tài khoản không gắn hồ sơ nhân viên (admin hệ thống).
 */
export function useNavigation(): NavGroup[] {
  const { data: me } = useMe();
  const { data: profile } = useMyProfile();
  const visible = (to: string) => canAccessPage(me?.roles, to) && (to !== PATHS.profile || !!profile);
  return NAVIGATION.map((g) => ({ ...g, items: g.items.filter((n) => visible(n.to)) })).filter((g) => g.items.length > 0);
}
