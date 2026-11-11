import { formatNumber } from '@/utils/number';
import type { IAiUsageDay } from '../../types/report.types';

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/** Cột chồng theo ngày (lịch VN): thành công · lỗi · bị chặn. Vẽ bằng CSS — không cần thư viện biểu đồ. */
export function AiUsageChart({ days }: { days: IAiUsageDay[] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const step = Math.max(1, Math.ceil(days.length / 10)); // tối đa ~10 nhãn ngày
  return (
    <div className="grid gap-2" data-testid="ai-usage-chart">
      <div className="flex h-40 items-end gap-px">
        {days.map((d) => {
          const ok = d.total - d.errors - d.blocked;
          return (
            <div key={d.date} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${dm(d.date)}: ${formatNumber(d.total)} request · ${formatNumber(d.errors)} lỗi · ${formatNumber(d.blocked)} bị chặn`}>
              <div className="flex flex-col justify-end overflow-hidden rounded-t-sm group-hover:opacity-80" style={{ height: `${(d.total / max) * 100}%` }}>
                {d.blocked > 0 && <div className="bg-warning" style={{ flexGrow: d.blocked }} />}
                {d.errors > 0 && <div className="bg-destructive" style={{ flexGrow: d.errors }} />}
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
    </div>
  );
}
