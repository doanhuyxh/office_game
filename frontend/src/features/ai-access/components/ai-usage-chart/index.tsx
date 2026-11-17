import { useMemo } from 'react';
import { formatNumber } from '@/utils/number';
import { cn } from '@/utils/cn';
import type { IAiUsageSummary } from '../../types/aiUsage.types';
import { allBuckets, bucketLabel, formatTokensShort, formatUsd, modelColor, totalTokens } from '../../utils/aiUsage';

export type AiUsageMetric = 'tokens' | 'cost';

/**
 * Cột chồng theo model, trục X = ngày / tháng / năm (TEST-136). Vẽ bằng CSS như biểu đồ Báo cáo → Trợ lý AI — không thêm thư viện.
 * Chú thích bấm để ẩn / hiện model (`hidden`). Nhiều kỳ → cuộn ngang (mỗi cột ≥ 14 px).
 */
export function AiUsageChart({ data, metric, hidden, onToggle }: {
  data: IAiUsageSummary; metric: AiUsageMetric; hidden: ReadonlySet<string>; onToggle: (model: string) => void;
}) {
  const models = useMemo(() => {
    // Thứ tự chồng cố định: model dùng nhiều nhất (theo chỉ số đang xem) ở đáy.
    const sum = new Map<string, number>();
    for (const g of data.groups) sum.set(g.model, (sum.get(g.model) ?? 0) + (metric === 'cost' ? g.costUsd : totalTokens(g)));
    return [...sum.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m]) => m);
  }, [data.groups, metric]);

  const columns = useMemo(() => {
    const buckets = allBuckets(data.group, data.from, data.to, data.buckets[0]?.bucket ?? undefined);
    return buckets.map((b) => {
      const parts = models.filter((m) => !hidden.has(m)).map((m) => {
        const g = data.groups.find((x) => x.bucket === b && x.model === m);
        return { model: m, value: g ? (metric === 'cost' ? g.costUsd : totalTokens(g)) : 0, missing: g?.costMissing ?? 0 };
      }).filter((p) => p.value > 0 || p.missing > 0);
      return { bucket: b, parts, total: parts.reduce((s, p) => s + p.value, 0) };
    });
  }, [data, models, hidden, metric]);

  const max = Math.max(...columns.map((c) => c.total), metric === 'cost' ? 0.01 : 1);
  const fmt = (v: number) => (metric === 'cost' ? formatUsd(v) : `${formatNumber(v, 0)} token`);
  const step = Math.max(1, Math.ceil(columns.length / 12)); // tối đa ~12 nhãn trục X

  return (
    <div className="grid gap-3" data-testid="ai-session-usage-chart">
      <div className="overflow-x-auto pb-1">
        <div className="grid gap-1" style={{ minWidth: `${columns.length * 14}px` }}>
          <div className="flex h-48 items-end gap-px border-b">
            {columns.map((c) => (
              <div key={c.bucket} className="group flex h-full min-w-0 flex-1 flex-col justify-end" data-testid="ai-usage-bar" data-bucket={c.bucket}
                title={[`${bucketLabel(c.bucket, true)}: ${fmt(c.total)}`, ...c.parts.map((p) =>
                  `• ${p.model}: ${fmt(p.value)}${metric === 'cost' && p.missing ? ` (${p.missing} phiên không có chi phí)` : ''}`)].join('\n')}>
                <div className="flex flex-col-reverse overflow-hidden rounded-t-sm group-hover:opacity-80" style={{ height: `${(c.total / max) * 100}%` }}>
                  {c.parts.map((p) => p.value > 0 && <div key={p.model} className={modelColor(p.model)} style={{ flexGrow: p.value }} />)}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-px text-[10px] text-muted-foreground">
            {columns.map((c, i) => <div key={c.bucket} className="min-w-0 flex-1 overflow-visible whitespace-nowrap">{i % step === 0 ? bucketLabel(c.bucket) : ''}</div>)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {models.map((m) => (
          <button key={m} type="button" onClick={() => onToggle(m)} aria-pressed={!hidden.has(m)} data-testid="ai-usage-legend"
            className={cn('inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-muted', hidden.has(m) && 'text-muted-foreground line-through opacity-60')}>
            <span className={cn('size-2.5 rounded-sm', modelColor(m))} />{m}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground" title={fmt(max)}>
          Cao nhất {metric === 'cost' ? formatUsd(max) : `${formatTokensShort(max)} token`} / {data.group === 'day' ? 'ngày' : data.group === 'month' ? 'tháng' : 'năm'}
        </span>
      </div>
    </div>
  );
}
