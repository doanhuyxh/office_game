import { useState } from 'react';
import { formatMoney } from '@/utils/money';
import { useElementWidth } from '../../hooks/useElementWidth';
import type { IForecastWeek } from '../../types/finance.types';
import { niceScale } from '../../utils/chart';
import { fmtDayMonth, fmtMoneyShort } from '../../utils/labels';

const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };
const SERIES = [
  { key: 'closingConservative', label: 'Thận trọng', line: 'stroke-chart-1', dot: 'fill-chart-1', swatch: 'bg-chart-1', dash: undefined },
  { key: 'closingExpected', label: 'Kỳ vọng', line: 'stroke-chart-2', dot: 'fill-chart-2', swatch: 'bg-chart-2', dash: '6 4' },
] as const;

/**
 * Hai đường số dư cuối tuần (Thận trọng · Kỳ vọng) qua 13 tuần, vạch 0 đậm; điểm âm tô màu destructive. SVG thuần, màu token.
 * Di chuột / Tab vào một tuần → dòng giá trị phía trên hiện số tuần đó.
 */
export function ForecastChart({ weeks }: { weeks: IForecastWeek[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = weeks.length;
  if (n === 0) return null;
  const sel = weeks[active ?? 0];
  const values = weeks.flatMap((w) => [w.closingConservative, w.closingExpected]);
  const scale = niceScale(Math.min(...values), Math.max(...values));
  const w = Math.max(width, 240);
  const innerW = w - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + ((scale.max - v) / (scale.max - scale.min || 1)) * innerH;
  const slot = innerW / n;
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const every = slot < 40 ? Math.ceil(40 / slot) : 1;

  return (
    <div className="grid grid-cols-1 gap-2 px-4 pb-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" aria-live="polite" data-testid="forecast-chart-readout">
        <span className="font-medium">Tuần {sel.week} ({fmtDayMonth(sel.from)}–{fmtDayMonth(sel.to)})</span>
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <i className={`h-0.5 w-3 ${s.swatch}`} />{s.label}
            <b className={`tabular-nums ${sel[s.key] < 0 ? 'text-destructive' : ''}`}>{formatMoney(sel[s.key])}</b>
          </span>
        ))}
      </div>
      <div ref={ref} className="w-full min-w-0 overflow-hidden">
        <svg width={w} height={H} role="img" aria-label="Biểu đồ số dư cuối tuần 13 tuần tới, đường Thận trọng và Kỳ vọng" className="block select-none" onMouseLeave={() => setActive(null)}>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'stroke-foreground/60' : 'stroke-border'} strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? undefined : '3 3'} />
              <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">{fmtMoneyShort(t)}</text>
            </g>
          ))}
          {weeks.map((wk, i) => (
            <g key={wk.week} tabIndex={0} role="group" className="outline-none" onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)}
              aria-label={`Tuần ${wk.week}: Thận trọng ${formatMoney(wk.closingConservative)}, Kỳ vọng ${formatMoney(wk.closingExpected)}`}>
              <rect x={PAD.left + slot * i} y={PAD.top} width={slot} height={innerH} className={(active ?? 0) === i ? 'fill-muted/60' : 'fill-transparent'} />
              {i % every === 0 && <text x={cx(i)} y={H - PAD.bottom + 16} textAnchor="middle" className="fill-muted-foreground text-[10px]">{fmtDayMonth(wk.from)}</text>}
              <title>{`Tuần ${wk.week} — Thận trọng ${formatMoney(wk.closingConservative)} · Kỳ vọng ${formatMoney(wk.closingExpected)}`}</title>
            </g>
          ))}
          {SERIES.map((s) => (
            <g key={s.key} className="pointer-events-none">
              <path d={weeks.map((wk, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(wk[s.key]).toFixed(1)}`).join(' ')} fill="none" className={s.line} strokeWidth={2} strokeDasharray={s.dash} />
              {weeks.map((wk, i) => (
                <circle key={wk.week} cx={cx(i)} cy={y(wk[s.key])} r={(active ?? 0) === i ? 4 : 2.5}
                  className={`${wk[s.key] < 0 ? 'fill-destructive' : s.dot} stroke-card`} strokeWidth={1.5} />
              ))}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
