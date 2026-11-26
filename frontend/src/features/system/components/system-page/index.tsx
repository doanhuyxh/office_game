import { BookOpen, ExternalLink, Mail, PanelsTopLeft, RefreshCw, ScrollText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { DEFAULT_CONFIG_SECTION, sectionOfSettingsGroup } from '../../utils/config-sections';
import { systemKeys } from '../../api/system.api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { useTabParam } from '@/hooks/useTabParam';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useSystemInfo } from '../../hooks/useSystem';
import { ConfigTab } from '../config-tab';
import { NotificationChannelsTab } from '../notification-channels-tab';
import { OpsTab } from '../ops-tab';
import { ServerResourceRows } from '../server-resources';
import { HealthRow, InfoRow as Row } from '../service-info';
import type { ISystemLink, SettingsGroupKey } from '../../types/system.types';

const LINK_ICON: Record<string, LucideIcon> = { docs: BookOpen, logs: ScrollText, mail: Mail };

/** Ghi chú có đoạn `lệnh` → hiện dạng code. */
function Note({ text }: { text: string }) {
  return <>{text.split('`').map((part, i) => (i % 2 ? <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">{part}</code> : part))}</>;
}

function LinkCard({ link, onEmbed }: { link: ISystemLink; onEmbed: (l: ISystemLink) => void }) {
  const Icon = LINK_ICON[link.key] ?? ExternalLink;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-muted-foreground" />{link.name}</CardTitle>
        <CardDescription><Note text={link.note} /></CardDescription>
      </CardHeader>
      <CardContent className="mt-auto grid gap-2">
        {link.url ? (
          <div className="flex flex-wrap gap-2">
            {link.embeddable !== false && (
              <Button size="sm" onClick={() => onEmbed(link)} data-testid={`system-embed-${link.key}`}>
                <PanelsTopLeft /> {link.embeddable ? 'Xem trong trang' : 'Thử xem trong trang'}
              </Button>
            )}
            <Button asChild variant="outline" size="sm" className="max-w-full">
              <a href={link.url} target="_blank" rel="noreferrer" data-testid={`system-link-${link.key}`}>
                <ExternalLink /> <span className="truncate">{link.url}</span>
              </a>
            </Button>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Chưa cấu hình đường dẫn</span>
        )}
        {link.url && link.embedNote && <p className="text-xs text-muted-foreground">{link.embedNote}</p>}
      </CardContent>
    </Card>
  );
}

/** Xem trang (tài liệu API, log…) ngay trong OfficeHub: hộp thoại gần toàn màn hình + iframe; luôn có "Mở tab mới" phòng khi trang không hiện. */
function EmbedDialog({ link, onClose }: { link: ISystemLink | null; onClose: () => void }) {
  return (
    <Dialog open={!!link} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-3 p-4 sm:max-w-[96vw]" data-testid="system-embed">
        <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8">
          <DialogTitle className="truncate">{link?.name}</DialogTitle>
          {link?.url && (
            <Button asChild variant="outline" size="sm"><a href={link.url} target="_blank" rel="noreferrer"><ExternalLink /> Mở tab mới</a></Button>
          )}
        </DialogHeader>
        <DialogDescription className="sr-only">Trang {link?.name} hiển thị trong OfficeHub</DialogDescription>
        {link?.url && <iframe src={link.url} title={link.name} className="min-h-0 w-full flex-1 rounded-md border bg-white" />}
        {link?.embeddable === null && (
          <p className="text-xs text-muted-foreground">Nếu khung trống / báo lỗi kết nối, trang đó không cho nhúng hoặc đang tắt — bấm "Mở tab mới".</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Tab của trang Hệ thống — thêm trang báo cáo / xem hệ thống mới: thêm một mục ở đây + component của nó. */
const TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'ops', label: 'Vận hành' },
  { id: 'channels', label: 'Kênh thông báo' },
  { id: 'config', label: 'Cấu hình' },
] as const;
const TAB_IDS = TABS.map((t) => t.id);
/** Đổi tab ngang → xoá mục con của tab Cấu hình (`?section=`). */
const TAB_OPTS = { reset: ['section'] } as const;
/** Tab cũ đã gộp vào Cấu hình (TEST-235) → mục tương ứng; link / bookmark cũ `?tab=smtp|storage` tự chuyển (replace). */
const LEGACY_TABS: Record<string, string> = { smtp: 'smtp', storage: 's3' };

/** Trang Hệ thống — chỉ quản trị viên (PAGE_ROLES + back-end AuthPolicies.Admin). Mỗi phần một tab, tab lưu trên URL (?tab=). */
export function SystemPage() {
  const [tab, setTab] = useTabParam('overview', TAB_IDS, TAB_OPTS);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const legacy = typeof search.tab === 'string' ? LEGACY_TABS[search.tab] : undefined;
  const [embed, setEmbed] = useState<ISystemLink | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useSystemInfo();
  const qc = useQueryClient();
  const opsFetching = useIsFetching({ queryKey: systemKeys.ops }) > 0;
  const channelsFetching = useIsFetching({ queryKey: systemKeys.channels }) > 0;
  /** Mở một mục của tab Cấu hình (`?tab=config&section=…`, replace — không thêm lịch sử). */
  const goConfig = useCallback((section: string) => {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => ({ ...prev, tab: 'config', section: section === DEFAULT_CONFIG_SECTION ? undefined : section })) as never,
      replace: true,
    });
  }, [navigate]);
  useEffect(() => { if (legacy) goConfig(legacy); }, [legacy, goConfig]);
  /** Từ tab Kênh thông báo sang đúng mục ở tab Cấu hình (vd `office_ips` → `office-ips`). */
  const openConfig = (group: SettingsGroupKey) => goConfig(sectionOfSettingsGroup(group));
  if (legacy) return null; // đang chuyển link cũ sang Cấu hình
  const info = isLoading ? <Spinner /> : error || !data ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : null;
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Hệ thống" />
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar
          actions={tab === 'ops' || tab === 'channels'
            ? <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: tab === 'ops' ? systemKeys.ops : systemKeys.channels })}
                disabled={tab === 'ops' ? opsFetching : channelsFetching}>
                <RefreshCw className={(tab === 'ops' ? opsFetching : channelsFetching) ? 'animate-spin' : ''} /> Làm mới
              </Button>
            : tab === 'overview' && <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={isFetching ? 'animate-spin' : ''} /> Kiểm tra lại</Button>}>
          <TabsList>{TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>
        </PageToolbar>

        <TabsContent value="overview" className="mt-4 grid gap-4">
          {info ?? (data && (
            <>
              <div className="grid gap-4 md:grid-cols-3 @7xl/content:grid-cols-4 @min-[112rem]/content:grid-cols-6">{data.links.map((l) => <LinkCard key={l.key} link={l} onEmbed={setEmbed} />)}</div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">Tình trạng dịch vụ</CardTitle></CardHeader>
                  <CardContent>{data.health.map((h) => <HealthRow key={h.name} h={h} />)}</CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Thông tin máy chủ</CardTitle></CardHeader>
                  <CardContent>
                    <Row label="Môi trường">{data.environment}</Row>
                    <Row label="Phiên bản">{data.version}</Row>
                    <Row label="Giờ máy chủ">{formatDateTime(data.serverTime)} ({data.timeZone})</Row>
                    <Row label="Khởi động lúc">{formatDateTime(data.startedAt)}</Row>
                    <Row label="Gửi log Seq">{data.seqEnabled ? 'Bật' : 'Tắt'}</Row>
                    <Row label="Sentry">{data.sentryEnabled ? 'Bật' : 'Tắt'}</Row>
                    <ServerResourceRows resources={data.resources} />
                    <p className="pt-3 text-xs text-muted-foreground">
                      Số liệu của máy chạy container Api. Nếu PostgreSQL hay S3 nằm ở máy khác (<code className="rounded bg-muted px-1">POSTGRES_HOST</code> trỏ ra ngoài) thì dung lượng của chúng không nằm trong số này.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          ))}
        </TabsContent>

        <TabsContent value="ops" className="mt-4"><OpsTab active={tab === 'ops'} /></TabsContent>
        <TabsContent value="channels" className="mt-4"><NotificationChannelsTab active={tab === 'channels'} onOpenConfig={openConfig} /></TabsContent>
        <TabsContent value="config" className="mt-4">{tab === 'config' && <ConfigTab />}</TabsContent>
      </Tabs>
      <EmbedDialog link={embed} onClose={() => setEmbed(null)} />
    </div>
  );
}
