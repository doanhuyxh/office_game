import { useState } from 'react';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate } from '@/features/finance';
import { formatMoney } from '@/utils/money';
import { useReceivables } from '../../hooks/useSales';
import type { InstallmentState } from '../../types/sales.types';
import { INSTALLMENT_STATE } from '../../utils/labels';

const FILTERS: InstallmentState[] = ['Overdue', 'DueSoon', 'Partial', 'Upcoming'];

/** Công nợ phải thu: đợt chưa thu đủ của hợp đồng đang hiệu lực, tổng theo tuổi nợ. */
export function ReceivablesTab({ onOpenContract }: { onOpenContract: (id: string) => void }) {
  const [state, setState] = useState<InstallmentState | null>(null);
  const { data, isLoading } = useReceivables(state ?? undefined);
  if (isLoading || !data) return <Spinner />;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 @min-[112rem]/content:grid-cols-[repeat(4,minmax(0,28rem))]">
        {[
          ['Tổng còn phải thu', data.outstanding, ''],
          ['Quá hạn', data.overdue, 'text-rose-600'],
          ['Sắp đến hạn (≤ 7 ngày)', data.dueSoon, 'text-amber-600'],
        ].map(([label, v, cls]) => (
          <div key={label as string} className="rounded-xl border bg-card p-3"><div className="text-sm text-muted-foreground">{label}</div><div className={`text-xl font-semibold tabular-nums ${cls}`}>{formatMoney(v as number)}</div></div>
        ))}
        <div className="rounded-xl border bg-card p-3 text-sm">
          <div className="text-muted-foreground">Tuổi nợ quá hạn (ngày)</div>
          {Object.entries(data.buckets).map(([b, v]) => <div key={b} className="flex justify-between tabular-nums"><span>{b}</span><span className={v ? 'text-rose-600' : 'text-muted-foreground'}>{formatMoney(v)}</span></div>)}
        </div>
      </div>
      <div className="w-56"><SelectField id="r-state" label="Lọc" allowEmpty emptyLabel="Tất cả chưa thu đủ" value={state} onChange={(v) => setState(v as InstallmentState | null)}
        options={FILTERS.map((s) => ({ value: s, label: INSTALLMENT_STATE[s].label }))} /></div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Hạn</TableHead><TableHead>Khách hàng</TableHead><TableHead>Hợp đồng · Đợt</TableHead><TableHead>Phụ trách</TableHead>
            <TableHead className="text-right">Còn phải thu</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.items.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Không có khoản phải thu</TableCell></TableRow>}
            {data.items.map((x) => (
              <TableRow key={x.installmentId} className="cursor-pointer" onClick={() => onOpenContract(x.contractId)} data-testid="receivable-row">
                <TableCell className="whitespace-nowrap">{fmtDate(x.dueOn)}</TableCell>
                <TableCell>{x.customerName}</TableCell>
                <TableCell className="text-sm"><span className="font-medium">{x.contractCode}</span> · {x.title}</TableCell>
                <TableCell className="text-sm">{x.ownerName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(x.remaining)}{x.collected > 0 && <div className="text-xs text-muted-foreground">/ {formatMoney(x.amount)}</div>}</TableCell>
                <TableCell><StatusBadge tone={INSTALLMENT_STATE[x.state].tone}>{INSTALLMENT_STATE[x.state].label}{x.agingBucket && ` · ${x.agingBucket}`}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
