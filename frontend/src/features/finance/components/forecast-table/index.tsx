import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatMoney } from '@/utils/money';
import type { IForecast, IForecastWeek } from '../../types/finance.types';
import { FORECAST_LINES, fmtDayMonth, type IForecastLineDef } from '../../utils/labels';

const STICKY = 'sticky left-0 z-10 bg-card shadow-[inset_-1px_0_0_var(--color-border)] max-sm:max-w-36 max-sm:whitespace-normal';

/**
 * Bảng dự báo 13 cột tuần (tiêu đề = khoảng ngày). Cột tên dòng dính khi cuộn ngang; bảng tự cuộn ngang trong khung (trang không cuộn ngang ở 375 px).
 * Ô có tiền bấm được → `onPick(tuần, dòng)` mở danh sách khoản tạo nên số đó. Tiền ra hiện dấu −; số dư âm tô destructive.
 */
export function ForecastTable({ data, onPick }: { data: IForecast; onPick: (week: IForecastWeek, def: IForecastLineDef) => void }) {
  const weeks = data.weeks;
  const closing = (label: string, key: 'closingConservative' | 'closingExpected', expected: boolean) => (
    <TableRow className="font-medium" data-testid={`forecast-row-${key}`}>
      <TableCell className={STICKY}>{label}{expected && <ExpectedTag />}</TableCell>
      {weeks.map((w) => (
        <TableCell key={w.week} data-negative={w[key] < 0 || undefined}
          className={`text-right tabular-nums ${w[key] < 0 ? 'bg-destructive/10 text-destructive' : ''}`}>{formatMoney(w[key])}</TableCell>
      ))}
    </TableRow>
  );
  return (
    <Table className="min-w-max" data-testid="forecast-table">
      <TableHeader>
        <TableRow>
          <TableHead className={`${STICKY} min-w-44 max-sm:min-w-32 max-sm:whitespace-normal`}>Khoản</TableHead>
          {weeks.map((w) => (
            <TableHead key={w.week} className="text-right" data-testid="forecast-week-head">
              <div className="text-xs text-muted-foreground">Tuần {w.week}</div>
              <div>{fmtDayMonth(w.from)}–{fmtDayMonth(w.to)}</div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className={`${STICKY} text-muted-foreground`} title="Tuần 1 = tổng số dư các quỹ đang dùng hôm nay; các tuần sau = số dư cuối tuần trước (Thận trọng)">Số dư đầu tuần</TableCell>
          {weeks.map((w, i) => <TableCell key={w.week} className="text-right tabular-nums text-muted-foreground">{formatMoney(i === 0 ? data.opening : weeks[i - 1].closingConservative)}</TableCell>)}
        </TableRow>
        {FORECAST_LINES.map((def) => (
          <TableRow key={def.line} data-testid={`forecast-row-${def.line}`}>
            <TableCell className={STICKY}>{def.out ? '− ' : '+ '}{def.label}{def.expectedOnly && <ExpectedTag />}</TableCell>
            {weeks.map((w) => {
              const v = w[def.field] as number;
              return (
                <TableCell key={w.week} className="p-0 text-right tabular-nums">
                  {v === 0
                    ? <span className="block px-2 text-muted-foreground/60">–</span>
                    : (
                      <button type="button" onClick={() => onPick(w, def)} data-testid={`forecast-cell-${def.line}-${w.week}`}
                        aria-label={`${def.label}, tuần ${w.week}: ${formatMoney(v)} — xem chi tiết`}
                        className={`block min-h-9 w-full px-2 text-right underline-offset-2 hover:bg-muted hover:underline focus-visible:bg-muted focus-visible:outline-none ${def.out ? 'text-destructive' : ''}`}>
                        {def.out ? `−${formatMoney(v)}` : formatMoney(v)}
                      </button>
                    )}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
        {closing('Số dư cuối · Thận trọng', 'closingConservative', false)}
        {closing('Số dư cuối · Kỳ vọng', 'closingExpected', true)}
      </TableBody>
    </Table>
  );
}

function ExpectedTag() {
  return <StatusBadge tone="info" className="ms-1.5 align-middle">Kỳ vọng</StatusBadge>;
}
