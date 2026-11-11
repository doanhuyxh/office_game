import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { formatDateTime } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import type { IAiUsageSummary } from '../../types/report.types';

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' | 'warning' }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4"><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className="px-4">
        <div className={`text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : ''}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const pct = (n: number, total: number) => (total ? `${formatNumber((n / total) * 100, 1)}%` : '0%');

/** Ô số liệu tổng của báo cáo AI. `single` = đang xem một người (bỏ ô "Số người"). */
export function AiUsageStats({ s, single }: { s: IAiUsageSummary; single?: boolean }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${single ? 'xl:grid-cols-4' : 'lg:grid-cols-3 xl:grid-cols-5'}`}>
      <Stat label="Tổng request" value={formatNumber(s.total)} sub={s.lastAt ? `Gần nhất ${formatDateTime(s.lastAt)}` : 'Chưa có'} />
      {!single && <Stat label="Số người dùng" value={formatNumber(s.users)} />}
      <Stat label="Thao tác ghi" value={formatNumber(s.writes)} sub={`${pct(s.writes, s.total)} · tạo / sửa / xoá`} />
      <Stat label="Lỗi" value={formatNumber(s.errors)} sub={pct(s.errors, s.total)} tone={s.errors ? 'danger' : undefined} />
      <Stat label="Bị chặn" value={formatNumber(s.blocked)} sub={`403 không được phép · 429 quá giới hạn · TB ${formatNumber(s.avgDurationMs)} ms`}
        tone={s.blocked ? 'warning' : undefined} />
    </div>
  );
}
