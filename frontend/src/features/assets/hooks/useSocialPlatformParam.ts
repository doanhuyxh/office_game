import { SOCIAL_PLATFORMS, FACEBOOK_PLATFORM, type SocialPlatformKey } from '@/config/social-platforms';
import { useTabParam } from '@/hooks/useTabParam';

const KEYS = SOCIAL_PLATFORMS.map((p) => p.key);

/** Sub-tab nền tảng của Tài sản → MXH trên URL: `?tab=social&platform=zalo-oa`; thiếu / lạ (link cũ `?tab=social`) → Facebook. */
export function useSocialPlatformParam() {
  const [platform, setPlatform] = useTabParam(FACEBOOK_PLATFORM.key, KEYS, { param: 'platform' });
  return [platform as SocialPlatformKey, setPlatform as (p: SocialPlatformKey) => void] as const;
}
