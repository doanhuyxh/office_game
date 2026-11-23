import { formatNumber } from '@/utils/number';
import { cn } from '@/utils/cn';
import { ChartHoverCard, ChartHoverHeader, ChartHoverRow, ChartHoverRows, useChartHover } from '@/components/common/chart-hover-card';
import type { IAiUsageDay } from '../../types/report.types';

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const longDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${dm(date)}/${date.slice(0, 4)}`;
};

/** Ba phần của một cột: thành công · lỗi · bị chặn (thứ tự hiện trong thẻ nổi). */
const parts = (d: IAiUsageDay) => [
  { key: 'ok', label: 'Thành công', color: 'bg-primary', value: d.total - d.errors - d.blocked },
  { key: 'err', label: 'Lỗi', color: 'bg-destructive', value: d.errors },
  { key: 'blocked', label: 'Bị chặn', color: 'bg-warning', value: d.blocked },
];
const share = (v: number, total: number) => (total > 0 ? `${formatNumber((v / total) * 100, 1)} %` : '');

/**
 * Cột chồng theo ngày (lịch VN): thành công · lỗi · bị chặn. Vẽ bằng CSS — không cần thư viện biểu đồ.
 * Trỏ / chạm / focus một cột → thẻ nổi `ChartHoverCard` (TEST-224): ngày, tổng request, từng phần kèm ô màu + %.
 */
export function AiUsageChart({ days }: { days: IAiUsageDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const step = Math.max(1, Math.ceil(days.length / 10)); // tối đa ~10 nhãn ngày
  const hover = useChartHover<string>();
  const active = hover.activeKey ? days.find((d) => d.date === hover.activeKey) : undefined;
  return (
    <div className="grid gap-2" data-testid="ai-usage-chart" ref={hover.containerRef}>
      <div className="flex h-40 items-end gap-px">
        {days.map((d) => {
          const [ok, err, blocked] = parts(d).map((p) => p.value);
          return (
            <div key={d.date} {...hover.bind(d.date)} role="button" data-testid="ai-usage-day-bar"
              aria-label={`${longDate(d.date)}: ${formatNumber(d.total)} request. ${parts(d).map((p) => `${p.label} ${formatNumber(p.value)}`).join(', ')}`}
              className={cn('relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-t-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring',
                hover.activeKey && hover.activeKey !== d.date && 'opacity-40')}>
              <div className="flex flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: `${(d.total / max) * 100}%` }}>
                {blocked > 0 && <div className="bg-warning" style={{ flexGrow: blocked }} />}
                {err > 0 && <div className="bg-destructive" style={{ flexGrow: err }} />}
                {ok > 0 && <div className="bg-primary" style={{ flexGrow: ok }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-px text-[10px] text-muted-foreground">
        {days.map((d, i) => <div key={d.date} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">{i % step === 0 ? dm(d.date) : ''}</div>)}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-primary" />Thành công</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-destructive" />Lỗi</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warning" />Bị chặn (403 / 429)</span>
        <span className="ml-auto">Cao nhất {formatNumber(max)} request / ngày</span>
      </div>
      <ChartHoverCard anchor={active ? hover.anchor : null}>
        {active && (
          <>
            <ChartHoverHeader title={longDate(active.date)} value={`${formatNumber(active.total)} request`} />
            <ChartHoverRows>
              {parts(active).map((p) => <ChartHoverRow key={p.key} color={p.color} label={p.label} value={formatNumber(p.value)} share={share(p.value, active.total)} />)}
            </ChartHoverRows>
          </>
        )}
      </ChartHoverCard>
    </div>
  );
}
