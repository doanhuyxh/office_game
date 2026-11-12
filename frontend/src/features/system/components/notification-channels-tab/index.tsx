import type { LucideIcon } from 'lucide-react';
import { Bell, BellRing, Mail, Send, Settings2, Webhook } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useNotificationChannels } from '../../hooks/useSystem';
import { NotificationEventsCard } from '../notification-events-card';
import type { INotificationChannel, SettingsGroupKey } from '../../types/system.types';

const ICON: Record<string, LucideIcon> = { bell: Bell, email: Mail, push: BellRing, webhook: Webhook, telegram: Send };
const HEALTH: Record<string, { tone: StatusTone; label: string }> = {
  ok: { tone: 'success', label: 'Hoạt động' },
  error: { tone: 'danger', label: 'Đang lỗi' },
  off: { tone: 'muted', label: 'Tắt / chưa cấu hình' },
};
const SOURCE: Record<string, string> = { builtin: 'Có sẵn', db: 'Lưu trên trang', env: '.env', user: 'Mỗi người tự cài', none: 'Chưa cấu hình' };
const MAX_USES = 6;

function Uses({ c }: { c: INotificationChannel }) {
  const shown = c.usedBy.slice(0, MAX_USES);
  const rest = c.usedBy.length - shown.length;
  if (c.usedBy.length === 0) return <span className="text-xs text-muted-foreground">Chưa có sự kiện nào</span>;
  return (
    <div className="flex flex-wrap gap-1" title={c.usedBy.map((u) => u.label).join(', ')}>
      {shown.map((u) => <span key={u.key} className="rounded bg-muted px-1.5 py-0.5 text-xs">{u.label}</span>)}
      {rest > 0 && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">+{rest} sự kiện</span>}
    </div>
  );
}

/**
 * Tab "Kênh thông báo" của trang Hệ thống (TEST-43): danh sách kênh do back-end đăng ký (module Notification) — trạng thái, nguồn cấu hình,
 * sự kiện dùng kênh (từ danh mục sự kiện ở back-end, TEST-59), lần gửi thành công / lỗi gần nhất. Không có giá trị bí mật. Thêm kênh ở back-end → bảng tự có.
 * Bên dưới: danh mục sự kiện thông báo theo nhóm (<NotificationEventsCard>).
 */
export function NotificationChannelsTab({ active, onOpenConfig }: { active: boolean; onOpenConfig: (group: SettingsGroupKey) => void }) {
  const { data, isLoading, error } = useNotificationChannels(active);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return (
    <div className="grid gap-6">
      <div className="overflow-x-auto rounded-md border" data-testid="notification-channels">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-64">Kênh</TableHead>
              <TableHead className="min-w-44">Trạng thái</TableHead>
              <TableHead className="min-w-44">Gửi gần nhất</TableHead>
              <TableHead className="min-w-56">Dùng cho</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => {
              const Icon = ICON[c.key] ?? Bell;
              const h = HEALTH[c.health] ?? { tone: 'muted' as const, label: c.health };
              return (
                <TableRow key={c.key} data-testid={`channel-${c.key}`} className="align-top">
                  <TableCell className="whitespace-normal">
                    <div className="flex items-center gap-2 font-medium"><Icon className="size-4 text-muted-foreground" />{c.name}</div>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">{c.description}</p>
                    {c.detail && <p className="mt-1 text-xs">{c.detail}</p>}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="grid gap-1">
                      <StatusBadge tone={h.tone}>{h.label}</StatusBadge>
                      <span className="text-xs text-muted-foreground">Nguồn: {SOURCE[c.source] ?? c.source}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">
                    <div>Thành công: {c.lastSuccessAt ? formatDateTime(c.lastSuccessAt) : '—'}</div>
                    <div>Lỗi: {c.lastFailureAt ? formatDateTime(c.lastFailureAt) : '—'}</div>
                    {c.lastError && <p className="mt-1 max-w-xs break-words text-destructive">{c.lastError}</p>}
                    {c.statsSince && <p className="mt-1 text-muted-foreground">Tính từ {formatDateTime(c.statsSince)} (Api khởi động)</p>}
                  </TableCell>
                  <TableCell className="whitespace-normal"><Uses c={c} /></TableCell>
                  <TableCell>
                    {c.configGroup ? (
                      <Button variant="outline" size="sm" onClick={() => onOpenConfig(c.configGroup!)} data-testid={`channel-${c.key}-config`}>
                        <Settings2 /> Cấu hình
                      </Button>
                    ) : c.key === 'webhook' ? (
                      <Button asChild variant="ghost" size="sm"><Link to="/ai-access">Kết nối AI</Link></Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <NotificationEventsCard active={active} />
    </div>
  );
}
