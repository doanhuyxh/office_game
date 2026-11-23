import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/common/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatMoney } from '@/utils/money';
import type { IDashboardMonth } from '../../types/finance.types';
import { fmtMonth } from '../../utils/labels';
import { BlockCard } from '../block-card';

/** Thu / chi / lãi từng mảng kinh doanh của một tháng (chọn tháng, mặc định tháng này) — số của `/finance/dashboard`. */
export function LineMonthCard({ months }: { months: IDashboardMonth[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const month = months.find((m) => m.month === picked) ?? months[months.length - 1];
  if (!month) return null;
  return (
    <BlockCard testId="line-month-card" title="Theo mảng kinh doanh" hint="Không tính chuyển quỹ"
      action={
        <Select value={month.month} onValueChange={setPicked}>
          <SelectTrigger size="sm" className="w-36" aria-label="Chọn tháng" data-testid="line-month-select"><SelectValue /></SelectTrigger>
          <SelectContent>{[...months].reverse().map((m) => <SelectItem key={m.month} value={m.month}>{fmtMonth(m.month)}</SelectItem>)}</SelectContent>
        </Select>
      }>
      <Table>
        <TableHeader><TableRow><TableHead>Mảng</TableHead><TableHead className="text-right">Thu</TableHead><TableHead className="text-right">Chi</TableHead><TableHead className="text-right">Lãi</TableHead></TableRow></TableHeader>
        <TableBody>
          {month.byLine.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Chưa có giao dịch trong {fmtMonth(month.month)}</TableCell></TableRow>}
          {month.byLine.map((l) => {
            const p = l.income - l.expense;
            return (
              <TableRow key={l.businessLineId ?? 'none'}>
                <TableCell className="font-medium">{l.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(l.income)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(l.expense)}</TableCell>
                <TableCell className={`text-right tabular-nums ${p < 0 ? 'text-destructive' : 'text-success'}`}>{formatMoney(p)}</TableCell>
              </TableRow>
            );
          })}
          {month.byLine.length > 1 && (
            <TableRow className="font-medium">
              <TableCell>Cộng</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(month.income)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(month.expense)}</TableCell>
              <TableCell className={`text-right tabular-nums ${month.profit < 0 ? 'text-destructive' : 'text-success'}`}>{formatMoney(month.profit)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </BlockCard>
  );
}
