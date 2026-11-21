import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { SOCIAL_PLATFORMS, type SocialPlatformKey } from '@/config/social-platforms';
import { FacebookAccountsPanel } from '../facebook-accounts-panel';
import { UnsupportedPlatformPanel } from '../unsupported-platform-panel';

/**
 * Tab MXH (HR) — mỗi nền tảng một sub-tab (`SOCIAL_PLATFORMS`, TEST-207), nhớ trên URL `?tab=social&platform=<key>` (thiếu → Facebook BM).
 * Facebook BM: tài khoản, token, bàn giao. Zalo OA / TikTok: "Chưa hỗ trợ". Thêm nền tảng: thay panel "Chưa hỗ trợ" của nó bằng panel thật ở đây.
 */
export function SocialTab({ platform, onPlatformChange, creating, onCreatedClose }: {
  platform: SocialPlatformKey; onPlatformChange: (p: SocialPlatformKey) => void; creating: boolean; onCreatedClose: () => void;
}) {
  return (
    <Tabs value={platform} onValueChange={(v) => onPlatformChange(v as SocialPlatformKey)} className="gap-4">
      <TabsList variant="line" data-testid="social-platform-tabs">
        {SOCIAL_PLATFORMS.map((p) => (
          <TabsTrigger key={p.key} value={p.key} data-testid={`social-platform-tab-${p.key}`}><p.icon /> {p.tabLabel}</TabsTrigger>
        ))}
      </TabsList>
      {SOCIAL_PLATFORMS.map((p) => (
        <TabsContent key={p.key} value={p.key}>
          {p.key === 'facebook'
            ? <FacebookAccountsPanel creating={creating} onCreatedClose={onCreatedClose} />
            : <UnsupportedPlatformPanel platform={p} />}
        </TabsContent>
      ))}
    </Tabs>
  );
}
