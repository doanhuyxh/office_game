import { Link } from '@tanstack/react-router';
import { BotBadge } from '@/components/common/bot-badge';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { useAiAlertsPage } from '../../hooks/useReports';
import type { IAiAlert } from '../../types/report.types';

const RULE: Record<string, { label: string; tone: StatusTone }> = {
  blocked: { label: 'Bị chặn nhiều', tone: 'warning' },
  errors: { label: 'Lỗi liên tục', tone: 'warning' },
  burst_writes: { label: 'Ghi dồn dập', tone: 'info' },
  bot_approval: { label: 'Bot duyệt đơn', tone: 'danger' },
};

/**
 * Cảnh báo trợ lý AI bất thường (job quét 5 phút / lần, cửa sổ 15 phút; admin nhận chuông). Phạm vi như báo cáo:
 * HR / admin mọi người, quản lý bản thân + cấp dưới. Bấm "Chi tiết" → sheet hoạt động của người đó; HR / admin có link thu hồi kết nối.
 */
export function AiAlertsPanel({ canRevoke, onOpen }: { canRevoke: boolean; onOpen: (a: IAiAlert) => void }) {
  const pg = usePageState('report-ai-alerts', '');
  const { data, isLoading } = useAiAlertsPage(pg.query);
  const items = data?.items ?? [];

  return (
    <div className="rounded-xl border bg-card" data-testid="ai-alerts-panel">
      <div className="px-4 pt-3 text-sm font-medium">
        Cảnh báo{data?.total ? <span className="ml-1.5 text-muted-foreground">({data.total})</span> : null}
      </div>
      {isLoading ? <div className="p-4"><Spinner /></div> : items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">Chưa có cảnh báo nào — trợ lý AI đang hoạt động bình thường.</p>
      ) : (
        <ul className="divide-y">
          {items.map((a) => {
            const rule = RULE[a.rule] ?? { label: a.rule, tone: 'muted' as const };
            return (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="ai-alert-row">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={rule.tone}>{rule.label}</StatusBadge>
                    <span className="font-medium">{a.fullName || a.userName || '—'}</span>
                    {a.isBot && <BotBadge />}
                    {a.departmentName && <span className="text-xs text-muted-foreground">{a.departmentName}</span>}
                  </div>
                  <p className="text-sm text-muted-foreground">{a.body}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
                </div>
                <div className="flex shrink-0 gap-3 text-sm">
                  <button type="button" className="text-primary hover:underline" onClick={() => onOpen(a)}>Chi tiết</button>
                  {canRevoke && (
                    <Link to="/ai-access" search={{ tab: 'company' } as never} className="text-destructive hover:underline">
                      Thu hồi kết nối
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(data?.total ?? 0) > 0 && <TablePagination state={pg} total={data?.total} unit="cảnh báo" />}
    </div>
  );
}
