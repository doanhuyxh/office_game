import { PLATFORM_UNSUPPORTED, unsupportedPlatformNames } from '@/features/assets';

/** Chú thích nhỏ "Zalo OA, TikTok: chưa hỗ trợ" — danh sách nền tảng lấy từ `SOCIAL_PLATFORMS` (module Assets). */
export function UnsupportedNote() {
  const names = unsupportedPlatformNames();
  if (!names) return null;
  return <p className="text-xs text-muted-foreground" data-testid="social-unsupported">{names}: {PLATFORM_UNSUPPORTED.label.toLowerCase()}.</p>;
}
