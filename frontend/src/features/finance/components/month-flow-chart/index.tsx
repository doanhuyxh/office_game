import { useState } from 'react';
import { formatMoney } from '@/utils/money';
import { useElementWidth } from '../../hooks/useElementWidth';
import type { IDashboardMonth } from '../../types/finance.types';
import { niceScale } from '../../utils/chart';
import { fmtMonth, fmtMonthShort, fmtMoneyShort } from '../../utils/labels';

const H = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

/**
 * Thu / chi / lãi theo tháng: cột thu – chi + đường lãi, SVG thuần (không thêm thư viện biểu đồ), màu theo token (sáng / tối).
 * Di chuột / Tab vào một tháng → dòng giá trị phía trên hiện số của tháng đó (mặc định tháng mới nhất). Số đầy đủ ở bảng bên dưới.
 */
export function MonthFlowChart({ months }: { months: IDashboardMonth[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = months.length;
  if (n === 0) return null;
  const sel = months[active ?? n - 1];
  const values = months.flatMap((m) => [m.income, m.expense, m.profit]);
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const w = Math.max(width, 240);
  const innerW = w - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((scale.max - v) / (scale.max - scale.min || 1)) * innerH;
  const slot = innerW / n;
  const bar = Math.max(2, Math.min(18, slot * 0.32));
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const every = slot < 34 ? Math.ceil(34 / slot) : 1; // nhãn trục X thưa ra khi hẹp (375 px)
  const profitPath = months.map((m, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(m.profit).toFixed(1)}`).join(' ');

  return (
    <div className="grid grid-cols-1 gap-2 px-4 pb-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-live="polite" data-testid="month-chart-readout">
        <span className="font-medium">{fmtMonth(sel.month)}</span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-success" />Thu <b className="tabular-nums">{formatMoney(sel.income)}</b></span>
        <span className="inline-flex items-center gap-1"><i className="size-2.5 rounded-sm bg-destructive/70" />Chi <b className="tabular-nums">{formatMoney(sel.expense)}</b></span>
        <span className="inline-flex items-center gap-1"><i className="h-0.5 w-3 bg-primary" />Lãi <b className={`tabular-nums ${sel.profit < 0 ? 'text-destructive' : ''}`}>{formatMoney(sel.profit)}</b></span>
      </div>
      <div ref={ref} className="w-full min-w-0 overflow-hidden">
        <svg width={w} height={H} role="img" aria-label={`Biểu đồ thu, chi, lãi ${n} tháng`} className="block select-none" onMouseLeave={() => setActive(null)}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-foreground/40' : 'stroke-border'} strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{fmtMoneyShort(t)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const on = (active ?? n - 1) === i;
            return (
              <g key={m.month} tabIndex={0} role="group" aria-label={`${fmtMonth(m.month)}: thu ${formatMoney(m.income)}, chi ${formatMoney(m.expense)}, lãi ${formatMoney(m.profit)}`}
                onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} className="outline-none">
                <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} className={on ? 'fill-muted/60' : 'fill-transparent'} />
                <rect x={cx(i) - bar - 1} y={Math.min(y(m.income), y(0))} width={bar} height={Math.abs(y(0) - y(m.income))} rx={2} className="fill-success" />
                <rect x={cx(i) + 1} y={Math.min(y(m.expense), y(0))} width={bar} height={Math.abs(y(0) - y(m.expense))} rx={2} className="fill-destructive/70" />
                {i % every === (n - 1) % every && (
                  <text x={cx(i)} y={H - PAD.bottom + 16} textAnchor="middle" className={`text-[10px] ${on ? 'fill-foreground font-medium' : 'fill-muted-foreground'}`}>{fmtMonthShort(m.month)}</text>
                )}
                <title>{`${fmtMonth(m.month)} — Thu ${formatMoney(m.income)} · Chi ${formatMoney(m.expense)} · Lãi ${formatMoney(m.profit)}`}</title>
              </g>
            );
          })}
          <path d={profitPath} fill="none" className="pointer-events-none stroke-primary" strokeWidth={2} />
          {months.map((m, i) => (
            <circle key={m.month} cx={cx(i)} cy={y(m.profit)} r={(active ?? n - 1) === i ? 4 : 2.5}
              className={`pointer-events-none ${m.profit < 0 ? 'fill-destructive' : 'fill-primary'} stroke-card`} strokeWidth={1.5} />
          ))}
        </svg>
      </div>
    </div>
  );
}
