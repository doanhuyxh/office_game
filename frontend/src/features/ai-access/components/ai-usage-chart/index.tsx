import { useMemo } from 'react';
import { formatNumber } from '@/utils/number';
import { cn } from '@/utils/cn';
import { ChartHoverCard, ChartHoverHeader, ChartHoverNote, ChartHoverRow, ChartHoverRows, useChartHover } from '@/components/common/chart-hover-card';
import type { IAiUsageSummary } from '../../types/aiUsage.types';
import { allBuckets, bucketLabel, bucketLongLabel, formatTokensShort, formatUsd, modelColor, totalTokens } from '../../utils/aiUsage';

export type AiUsageMetric = 'tokens' | 'cost';

/**
 * Cột chồng theo model, trục X = ngày / tháng / năm (TEST-136). Vẽ bằng CSS như biểu đồ Báo cáo → Trợ lý AI — không thêm thư viện.
 * Chú thích bấm để ẩn / hiện model (`hidden`). Nhiều kỳ → cuộn ngang (mỗi cột ≥ 14 px).
 * Trỏ / chạm / focus một cột → thẻ nổi `ChartHoverCard` (TEST-224): kỳ, tổng token + chi phí, từng model (ô màu, số rút gọn, %), phiên thiếu chi phí.
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
        const tokens = g ? totalTokens(g) : 0, cost = g?.costUsd ?? 0;
        return { model: m, tokens, cost, value: metric === 'cost' ? cost : tokens, missing: g?.costMissing ?? 0 };
      }).filter((p) => p.value > 0 || p.missing > 0);
      return {
        bucket: b, parts, total: parts.reduce((s, p) => s + p.value, 0),
        tokens: parts.reduce((s, p) => s + p.tokens, 0), cost: parts.reduce((s, p) => s + p.cost, 0), missing: parts.reduce((s, p) => s + p.missing, 0),
      };
    });
  }, [data, models, hidden, metric]);

  const hover = useChartHover<string>();
  const max = Math.max(...columns.map((c) => c.total), metric === 'cost' ? 0.01 : 1);
  const fmt = (v: number) => (metric === 'cost' ? formatUsd(v) : `${formatNumber(v, 0)} token`);
  const step = Math.max(1, Math.ceil(columns.length / 12)); // tối đa ~12 nhãn trục X

  /** Nội dung thẻ của một cột (cũng dùng làm `aria-label`): model sắp giảm dần, số rút gọn, % trong kỳ. */
  const card = (c: (typeof columns)[number]) => {
    const tokensText = `${formatTokensShort(c.tokens)} token`, costText = formatUsd(c.cost);
    const rows = [...c.parts].sort((a, b) => b.value - a.value).map((p) => ({
      model: p.model,
      value: metric === 'cost' ? formatUsd(p.cost) : formatTokensShort(p.tokens),
      share: c.total > 0 ? `${formatNumber((p.value / c.total) * 100, 1)} %` : '',
    }));
    return {
      title: bucketLongLabel(c.bucket),
      value: metric === 'cost' ? costText : tokensText,
      extra: metric === 'cost' ? tokensText : costText,
      rows,
      note: c.missing > 0 ? `${c.missing} phiên không có chi phí` : null,
    };
  };
  const ariaLabel = (c: (typeof columns)[number]) => {
    const k = card(c);
    return [`${k.title}: ${k.value} · ${k.extra}`, ...k.rows.map((r) => `${r.model} ${r.value}${r.share ? ` (${r.share})` : ''}`), k.note].filter(Boolean).join('. ');
  };
  const activeCol = hover.activeKey ? columns.find((c) => c.bucket === hover.activeKey) : undefined;
  const active = activeCol ? card(activeCol) : null;

  return (
    <div className="grid gap-3" data-testid="ai-session-usage-chart" ref={hover.containerRef}>
      <div className="overflow-x-auto pb-1">
        <div className="grid gap-1" style={{ minWidth: `${columns.length * 14}px` }}>
          <div className="flex h-48 items-end gap-px border-b">
            {columns.map((c) => (
              <div key={c.bucket} {...hover.bind(c.bucket)} role="button" aria-label={ariaLabel(c)} data-testid="ai-usage-bar" data-bucket={c.bucket}
                className={cn('flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-t-sm outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring',
                  hover.activeKey && hover.activeKey !== c.bucket && 'opacity-40')}>
                <div className="flex flex-col-reverse overflow-hidden rounded-t-sm" style={{ height: `${(c.total / max) * 100}%` }}>
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
      <ChartHoverCard anchor={active ? hover.anchor : null}>
        {active && (
          <>
            <ChartHoverHeader title={active.title} value={active.value} extra={active.extra} />
            {active.rows.length > 0 && (
              <ChartHoverRows>
                {active.rows.map((r) => <ChartHoverRow key={r.model} color={modelColor(r.model)} label={r.model} value={r.value} share={r.share} />)}
              </ChartHoverRows>
            )}
            {active.note && <ChartHoverNote>{active.note}</ChartHoverNote>}
          </>
        )}
      </ChartHoverCard>
    </div>
  );
}
