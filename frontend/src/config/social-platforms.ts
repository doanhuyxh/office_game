import type { LucideIcon } from 'lucide-react';
import { Megaphone, MessageCircle, Music2 } from 'lucide-react';
import type { StatusTone } from '@/components/common/StatusBadge';
import { PATHS } from './paths';

/**
 * Các nền tảng mạng xã hội — NGUỒN DUY NHẤT cho tên, đường dẫn trang, trạng thái hỗ trợ (TEST-203, TEST-207).
 * Đọc từ đây: menu nhóm "Mạng xã hội" (`components/layout/navigation.ts`), sub-tab Tài sản → MXH (`?tab=social&platform=<key>`),
 * trang "Chưa hỗ trợ" (`features/social`). Làm Zalo OA / TikTok: đổi `supported` + `note` ở đây rồi thay trang / panel "Chưa hỗ trợ"
 * của nền tảng đó bằng trang thật — xem `.agent/business/assets-social.md` mục "Thêm nền tảng mới".
 */
export type SocialPlatformKey = 'facebook' | 'zalo-oa' | 'tiktok';
export interface SocialPlatformInfo {
  key: SocialPlatformKey;
  /** Tên ngắn — menu, trang đăng bài. */
  name: string;
  /** Tên tài khoản quản lý ở Tài sản → MXH (tiêu đề, hộp thoại, sheet). */
  label: string;
  /** Nhãn sub-tab ở Tài sản → MXH. */
  tabLabel: string;
  /** Trang đăng bài / xem trang của nền tảng. */
  path: string;
  icon: LucideIcon;
  supported: boolean;
  note: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatformInfo[] = [
  {
    key: 'facebook', name: 'Facebook', label: 'Facebook Business Manager (BM)', tabLabel: 'Facebook BM', path: PATHS.socialFacebook, icon: Megaphone,
    supported: true, note: 'Đăng bài lên các Fanpage Facebook của BM.',
  },
  {
    key: 'zalo-oa', name: 'Zalo OA', label: 'Zalo OA', tabLabel: 'Zalo OA', path: PATHS.socialZaloOa, icon: MessageCircle,
    supported: false, note: 'Chưa kết nối. Zalo cá nhân không có API — chỉ Zalo Official Account mới kết nối được.',
  },
  {
    key: 'tiktok', name: 'TikTok', label: 'TikTok', tabLabel: 'TikTok', path: PATHS.socialTiktok, icon: Music2,
    supported: false, note: 'Chưa kết nối.',
  },
];

export const FACEBOOK_PLATFORM = SOCIAL_PLATFORMS[0];
export const PLATFORM_UNSUPPORTED: { label: string; tone: StatusTone } = { label: 'Chưa hỗ trợ', tone: 'muted' };
export const socialPlatform = (key: SocialPlatformKey) => SOCIAL_PLATFORMS.find((p) => p.key === key)!;
/** Mọi đường dẫn trang MXH (menu ẩn / hiện cùng một điều kiện — `useNavigation`). */
export const SOCIAL_PATHS: readonly string[] = SOCIAL_PLATFORMS.map((p) => p.path);
