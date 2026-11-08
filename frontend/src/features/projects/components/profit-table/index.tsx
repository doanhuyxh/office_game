import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { useAllFinancials } from '../../hooks/useProjects';
import { PROJECT_STATUS } from '../../utils/labels';

/** Lãi / lỗ mọi dự án (quyền Xem tài chính). Dự án lỗ / vượt ngân sách ngày công được đánh dấu. Bấm dòng → tab Tài chính của dự án. */
export function ProfitTable() {
  const [showClosed, setShowClosed] = useState(false);
  const { data = [], isLoading, error } = useAllFinancials(showClosed ? undefined : 'Active', true);
  const navigate = useNavigate();
  if (isLoading) return <Spinner />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const sum = (k: 'revenue' | 'labor' | 'directExpense' | 'profit') => data.reduce((t, r) => t + r[k], 0);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Doanh thu = hợp đồng sau thuế; chi phí = VAT + nhân công + chi trực tiếp gắn dự án. Không gồm chi phí chung.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Gồm dự án đã đóng</label>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Dự án</TableHead><TableHead className="text-right">Doanh thu</TableHead><TableHead className="text-right">Nhân công</TableHead>
            <TableHead className="text-right">Chi trực tiếp</TableHead><TableHead className="text-right">Lãi / lỗ</TableHead><TableHead className="text-right">Biên</TableHead>
            <TableHead className="text-right">Còn phải thu</TableHead><TableHead className="text-right">Ngày công</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">Chưa có dự án</TableCell></TableRow>}
            {[...data].sort((a, b) => a.profit - b.profit).map((r) => {
              const over = r.budgetManDays != null && r.manDays > r.budgetManDays;
              return (
                <TableRow key={r.projectId} className="cursor-pointer" data-testid="profit-row"
                  onClick={() => void navigate({ to: '/projects/$projectId', params: { projectId: r.projectId }, search: { tab: 'finance' } as never })}>
                  <TableCell><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.code}
                    {r.status !== 'Active' && <> · {PROJECT_STATUS[r.status].label}</>}{r.hasEstimate && ' · có ước tính'}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.labor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.directExpense)}</TableCell>
                  <TableCell className={`text-right font-medium tabular-nums ${r.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatMoney(r.profit)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.marginPercent != null ? `${r.marginPercent.toLocaleString('vi-VN')}%` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(r.outstanding)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.manDays.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}
                    {r.budgetManDays != null && <span className="text-xs text-muted-foreground"> / {r.budgetManDays.toLocaleString('vi-VN')}</span>}
                    {over && <StatusBadge tone="danger" className="ml-1">Vượt</StatusBadge>}</TableCell>
                </TableRow>
              );
            })}
            {data.length > 1 && (
              <TableRow className="font-semibold">
                <TableCell>Tổng</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(sum('revenue'))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(sum('labor'))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(sum('directExpense'))}</TableCell>
                <TableCell className={`text-right tabular-nums ${sum('profit') < 0 ? 'text-rose-600' : ''}`}>{formatMoney(sum('profit'))}</TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
