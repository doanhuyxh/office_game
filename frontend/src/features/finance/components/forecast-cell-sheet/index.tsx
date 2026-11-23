import { Link } from '@tanstack/react-router';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PATHS } from '@/config/paths';
import { formatMoney } from '@/utils/money';
import type { IForecast, IForecastItem, IForecastWeek } from '../../types/finance.types';
import { fmtDate, fmtDayMonth, type IForecastLineDef } from '../../utils/labels';

const linkCls = 'text-primary hover:underline';

/** Link mở chi tiết theo loại khoản (khách / hợp đồng / cơ hội / dịch vụ / đề nghị chi). Lương, khoản định kỳ: không có trang riêng. */
function ItemLinks({ item }: { item: IForecastItem }) {
  switch (item.line) {
    case 'Installment':
    case 'Overdue':
      return (
        <span className="flex flex-wrap gap-x-3">
          {item.customerId && <Link to={PATHS.sales} search={{ customer: item.customerId } as never} className={linkCls} data-testid="forecast-item-customer">Khách hàng</Link>}
          {item.refCode && <Link to={PATHS.sales} search={{ tab: 'contracts' } as never} className={linkCls}>Hợp đồng {item.refCode}</Link>}
        </span>
      );
    case 'Pipeline':
      return (
        <span className="flex flex-wrap gap-x-3">
          {item.customerId && <Link to={PATHS.sales} search={{ customer: item.customerId } as never} className={linkCls}>Khách hàng</Link>}
          <Link to={PATHS.sales} search={{ tab: 'opportunities' } as never} className={linkCls}>Cơ hội</Link>
        </span>
      );
    case 'Renewal':
      return <Link to={PATHS.assets} search={{ tab: 'services' } as never} className={linkCls}>Dịch vụ (Tài sản)</Link>;
    case 'Expense':
      return <Link to={PATHS.finance} search={{ tab: 'expenses' } as never} className={linkCls}>Đề nghị chi {item.refCode}</Link>;
    default:
      return null;
  }
}

/** Danh sách khoản tạo nên một ô của bảng dự báo (tên, ngày, tiền + link). Dòng lương chỉ có tổng (không chi tiết theo người). */
export function ForecastCellSheet({ data, cell, onClose }: { data: IForecast; cell: { week: IForecastWeek; def: IForecastLineDef } | null; onClose: () => void }) {
  const items = cell ? data.items.filter((i) => i.week === cell.week.week && i.line === cell.def.line) : [];
  const total = cell ? (cell.week[cell.def.field] as number) : 0;
  return (
    <Sheet open={!!cell} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="forecast-cell-sheet">
        {cell && <>
          <SheetHeader>
            <SheetTitle>{cell.def.label}</SheetTitle>
            <SheetDescription>
              Tuần {cell.week.week} ({fmtDayMonth(cell.week.from)}–{fmtDayMonth(cell.week.to)}) · tổng {cell.def.out ? '−' : ''}{formatMoney(total)}
              {cell.def.expectedOnly && ' · chỉ tính ở đường Kỳ vọng'}
            </SheetDescription>
          </SheetHeader>
          {cell.def.line === 'Payroll' && (
            <p className="px-4 text-sm text-muted-foreground">
              Tổng chi phí lương công ty một tháng (lương gộp + BH công ty đóng){data.payroll.estimated && <> — <b>ước tính</b> đủ công vì kỳ lương tháng này chưa chốt</>}.
              Không có chi tiết theo người.
            </p>
          )}
          <ul className="divide-y px-4 pb-4" data-testid="forecast-cell-items">
            {items.map((it, i) => (
              <li key={`${it.refId ?? 'x'}-${it.date ?? ''}-${i}`} className="grid gap-1 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium">{it.name}</span>
                  <span className={`shrink-0 tabular-nums ${cell.def.out ? 'text-destructive' : ''}`}>{cell.def.out ? '−' : ''}{formatMoney(it.amount)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{it.date ? fmtDate(it.date) : 'Không có ngày cần chi'}</span>
                  {it.late && <StatusBadge tone="warning">{it.line === 'Renewal' ? 'Quá ngày gia hạn' : 'Quá hạn'}</StatusBadge>}
                  <ItemLinks item={it} />
                </div>
              </li>
            ))}
          </ul>
        </>}
      </SheetContent>
    </Sheet>
  );
}
