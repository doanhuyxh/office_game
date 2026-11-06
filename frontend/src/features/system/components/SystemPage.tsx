import { BookOpen, ExternalLink, Mail, RefreshCw, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useSystemInfo } from '../hooks/useSystem';
import type { IHealthItem, ISystemLink } from '../types/system.types';

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

function LinkCard({ link }: { link: ISystemLink }) {
  const Icon = LINK_ICON[link.key] ?? ExternalLink;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Icon className="size-4 text-muted-foreground" />{link.name}</CardTitle>
        <CardDescription><Note text={link.note} /></CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        {link.url ? (
          <Button asChild variant="outline" size="sm" className="max-w-full">
            <a href={link.url} target="_blank" rel="noreferrer" data-testid={`system-link-${link.key}`}>
              <ExternalLink /> <span className="truncate">{link.url}</span>
            </a>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">Chưa cấu hình đường dẫn</span>
        )}
      </CardContent>
    </Card>
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

/** Trang Hệ thống — chỉ quản trị viên (PAGE_ROLES + back-end AuthPolicies.Admin). */
export function SystemPage() {
  const { data, isLoading, isFetching, error, refetch } = useSystemInfo();
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Hệ thống" />
      <PageToolbar
        actions={<Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={isFetching ? 'animate-spin' : ''} /> Kiểm tra lại</Button>}
      />
      {isLoading ? <Spinner /> : error || !data ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">{data.links.map((l) => <LinkCard key={l.key} link={l} />)}</div>
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
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Cấu hình gửi mail (SMTP)</CardTitle>
                <CardDescription>Sửa trong <code className="rounded bg-muted px-1 text-xs">.env</code> (<code className="rounded bg-muted px-1 text-xs">Smtp__*</code>) rồi khởi động lại Api. Mật khẩu không hiển thị.</CardDescription>
              </CardHeader>
              <CardContent>
                <Row label="Máy chủ">{data.smtp.host}:{data.smtp.port} · {data.smtp.useSsl ? 'SSL' : 'STARTTLS / không mã hoá'}</Row>
                <Row label="Tài khoản">{data.smtp.username ?? '—'}</Row>
                <Row label="Gửi từ">{data.smtp.fromName} &lt;{data.smtp.fromEmail}&gt;</Row>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
