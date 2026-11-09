import { BookOpen, ExternalLink, Mail, PanelsTopLeft, RefreshCw, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { systemKeys } from '../../api/system.api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { useTabParam } from '@/hooks/useTabParam';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useSystemInfo } from '../../hooks/useSystem';
import { OpsTab } from '../ops-tab';
import { StorageCard } from '../storage-card';
import type { IHealthItem, ISystemLink } from '../../types/system.types';

const LINK_ICON: Record<string, LucideIcon> = { docs: BookOpen, logs: ScrollText, mail: Mail };
const HEALTH_NAME: Record<string, string> = { postgres: 'Cơ sở dữ liệu (PostgreSQL)', s3: 'Lưu trữ file (S3)', smtp: 'Máy chủ gửi mail (SMTP)' };
const HEALTH: Record<string, { tone: StatusTone; label: string }> = {
  Healthy: { tone: 'success', label: 'Hoạt động' },
  Degraded: { tone: 'warning', label: 'Chậm / một phần' },
  Unhealthy: { tone: 'danger', label: 'Lỗi' },
};

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

function HealthRow({ h }: { h: IHealthItem }) {
  const s = HEALTH[h.status] ?? { tone: 'muted' as const, label: h.status };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2.5 last:border-0">
      <span className="font-medium">{HEALTH_NAME[h.name] ?? h.name}</span>
      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      <span className="ms-auto text-xs text-muted-foreground">{h.durationMs} ms</span>
      {h.detail && <p className="basis-full text-sm text-destructive">{h.detail}</p>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}

/** Tab của trang Hệ thống — thêm trang báo cáo / xem hệ thống mới: thêm một mục ở đây + component của nó. */
const TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'smtp', label: 'Email (SMTP)' },
  { id: 'storage', label: 'Lưu trữ S3' },
  { id: 'ops', label: 'Vận hành' },
] as const;

/** Trang Hệ thống — chỉ quản trị viên (PAGE_ROLES + back-end AuthPolicies.Admin). Mỗi phần một tab, tab lưu trên URL (?tab=). */
export function SystemPage() {
  const [tab, setTab] = useTabParam('overview', TABS.map((t) => t.id));
  const [embed, setEmbed] = useState<ISystemLink | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useSystemInfo();
  const qc = useQueryClient();
  const opsFetching = useIsFetching({ queryKey: systemKeys.ops }) > 0;
  const info = isLoading ? <Spinner /> : error || !data ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : null;
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Hệ thống" />
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar
          actions={tab === 'ops'
            ? <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: systemKeys.ops })} disabled={opsFetching}><RefreshCw className={opsFetching ? 'animate-spin' : ''} /> Làm mới</Button>
            : tab !== 'storage' && <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={isFetching ? 'animate-spin' : ''} /> Kiểm tra lại</Button>}>
          <TabsList>{TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>
        </PageToolbar>

        <TabsContent value="overview" className="mt-4 grid gap-4">
          {info ?? (data && (
            <>
              <div className="grid gap-4 md:grid-cols-3">{data.links.map((l) => <LinkCard key={l.key} link={l} onEmbed={setEmbed} />)}</div>
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
                  </CardContent>
                </Card>
              </div>
            </>
          ))}
        </TabsContent>

        <TabsContent value="smtp" className="mt-4">
          {info ?? (data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cấu hình gửi mail (SMTP)</CardTitle>
                <CardDescription>Sửa trong <code className="rounded bg-muted px-1 text-xs">.env</code> (<code className="rounded bg-muted px-1 text-xs">Smtp__*</code>) rồi khởi động lại Api. Mật khẩu không hiển thị.</CardDescription>
              </CardHeader>
              <CardContent>
                <Row label="Máy chủ">{data.smtp.host}:{data.smtp.port} · {data.smtp.useSsl ? 'SSL' : 'STARTTLS / không mã hoá'}</Row>
                <Row label="Tài khoản">{data.smtp.username ?? '—'}</Row>
                <Row label="Gửi từ">{data.smtp.fromName} &lt;{data.smtp.fromEmail}&gt;</Row>
                {data.health.filter((h) => h.name === 'smtp').map((h) => <HealthRow key={h.name} h={h} />)}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="storage" className="mt-4"><StorageCard /></TabsContent>
        <TabsContent value="ops" className="mt-4"><OpsTab active={tab === 'ops'} /></TabsContent>
      </Tabs>
      <EmbedDialog link={embed} onClose={() => setEmbed(null)} />
    </div>
  );
}
