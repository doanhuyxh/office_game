import { canAccessPage } from '@/config/access';
import { PATHS } from '@/config/paths';
import { useMe } from '@/features/auth';
import { useMyProfile } from '@/features/profile';
import { SOCIAL_PATHS } from '@/config/social-platforms';
import { useFacebookPages } from '@/features/social';
import { NAVIGATION, type NavGroup } from './navigation';

/**
 * Menu đã lọc theo vai trò (PAGE_ROLES — chỉ để hiển thị, quyền thật kiểm tra ở back-end). Bỏ nhóm rỗng.
 * "Hồ sơ cá nhân" ẩn với tài khoản không gắn hồ sơ nhân viên (admin hệ thống).
 * Nhóm "Mạng xã hội" (Facebook · Zalo OA · TikTok — TEST-207) chỉ hiện với HR / admin và người đang giữ tài khoản MXH: hiện chỉ có Facebook,
 * nên là người được bàn giao Business Manager có ít nhất một trang. Có tài khoản Zalo OA / TikTok thì cộng thêm điều kiện của nền tảng đó.
 */
export function useNavigation(): NavGroup[] {
  const { data: me } = useMe();
  const { data: profile } = useMyProfile();
  const isHr = !!me?.roles.some((r) => r === 'admin' || r === 'hr');
  const { data: socialPages } = useFacebookPages(!!me && !isHr);
  const visible = (to: string) => canAccessPage(me?.roles, to) && (to !== PATHS.profile || !!profile)
    && (!SOCIAL_PATHS.includes(to) || isHr || (socialPages?.length ?? 0) > 0);
  return NAVIGATION.map((g) => ({ ...g, items: g.items.filter((n) => visible(n.to)) })).filter((g) => g.items.length > 0);
}
