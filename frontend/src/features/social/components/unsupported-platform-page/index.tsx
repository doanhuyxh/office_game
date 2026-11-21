import { Link } from '@tanstack/react-router';
import { Plug } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { PATHS } from '@/config/paths';
import { PLATFORM_UNSUPPORTED, socialPlatform, type SocialPlatformKey } from '@/config/social-platforms';
import { useMe } from '@/features/auth';

/**
 * Trang của nền tảng MXH chưa hỗ trợ (Zalo OA, TikTok — TEST-207): tên + dòng giải thích từ `SOCIAL_PLATFORMS`. Không gọi API.
 * Làm nền tảng đó → thay trang này bằng trang thật trong `routes/router.tsx` và đổi `supported` ở `config/social-platforms.ts`.
 */
export function UnsupportedPlatformPage({ platform }: { platform: SocialPlatformKey }) {
  const p = socialPlatform(platform);
  const isHr = !!useMe().data?.roles.some((r) => r === 'admin' || r === 'hr');
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title={p.name} />
      <div className="mx-auto grid w-full max-w-lg justify-items-center gap-3 rounded-xl border bg-card p-8 text-center" data-testid={`social-unsupported-${p.key}`}>
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"><p.icon className="size-6" /></span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <h2 className="text-lg font-semibold">{p.name}</h2>
          <StatusBadge tone={PLATFORM_UNSUPPORTED.tone}>{PLATFORM_UNSUPPORTED.label}</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">{p.note}</p>
        {isHr && (
          <Link to={PATHS.assets} search={{ tab: 'social', platform: p.key }} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            <Plug className="size-4" /> Tài sản → MXH → {p.tabLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

export const ZaloOaPage = () => <UnsupportedPlatformPage platform="zalo-oa" />;
export const TiktokPage = () => <UnsupportedPlatformPage platform="tiktok" />;
