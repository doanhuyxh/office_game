import { Link } from '@tanstack/react-router';
import { PATHS } from '@/config/paths';
import { formatMoney } from '@/utils/money';
import type { IDashboard } from '../../types/finance.types';
import { AGING_LABEL } from '../../utils/labels';
import { BlockCard } from '../block-card';

/** Công nợ quá hạn + tuổi nợ (toàn công ty) → tab Công nợ của Kinh doanh. */
export function ReceivablesCard({ data }: { data: IDashboard['receivables'] }) {
  const max = Math.max(1, ...data.aging.map((a) => a.amount));
  return (
    <BlockCard testId="receivables-card" title="Công nợ quá hạn"
      hint={`Còn phải thu ${formatMoney(data.outstanding)} · đến hạn trong 7 ngày ${formatMoney(data.dueSoon)}`}
      action={<Link to={PATHS.sales} search={{ tab: 'receivables' } as never} className="text-sm text-primary hover:underline" data-testid="receivables-link">Xem công nợ</Link>}>
      <div className="grid gap-3 p-4">
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-semibold tabular-nums ${data.overdue > 0 ? 'text-destructive' : ''}`} data-testid="receivables-overdue">{formatMoney(data.overdue)}</span>
          <span className="text-sm text-muted-foreground">{data.overdueCount} đợt quá hạn</span>
        </div>
        <ul className="grid gap-2">
          {data.aging.map((a) => (
            <li key={a.bucket} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-2 text-sm">
              <span className="text-muted-foreground">{AGING_LABEL[a.bucket]}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-destructive/70" style={{ width: `${(a.amount / max) * 100}%` }} /></span>
              <span className="tabular-nums">{formatMoney(a.amount)}<span className="text-muted-foreground"> · {a.count} đợt</span></span>
            </li>
          ))}
        </ul>
      </div>
    </BlockCard>
  );
}
