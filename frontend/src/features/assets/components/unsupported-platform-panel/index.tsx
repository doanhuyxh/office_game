import { StatusBadge } from '@/components/common/StatusBadge';
import { PLATFORM_UNSUPPORTED, type SocialPlatformInfo } from '@/config/social-platforms';

/** Sub-tab của nền tảng chưa hỗ trợ (Zalo OA, TikTok) ở Tài sản → MXH: chỉ hiển thị, không nút / API. */
export function UnsupportedPlatformPanel({ platform: p }: { platform: SocialPlatformInfo }) {
  return (
    <section className="grid content-start gap-1.5 rounded-xl border bg-card p-4" data-testid={`social-platform-${p.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p.icon className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">{p.label}</h2>
        <StatusBadge tone={PLATFORM_UNSUPPORTED.tone}>{PLATFORM_UNSUPPORTED.label}</StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground">{p.note}</p>
    </section>
  );
}
