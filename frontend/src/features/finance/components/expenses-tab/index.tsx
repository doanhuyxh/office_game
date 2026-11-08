import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Tabs, TabsList, TabsTrigger } from '@/components/common/tabs';
import { PATHS } from '@/config/paths';
import { formatMoney } from '@/utils/money';
import { useExpenses, useFinancePerms } from '../../hooks/useFinance';
import type { ExpenseStatus, IExpense } from '../../types/finance.types';
import { EXPENSE_STATUS, fmtDate } from '../../utils/labels';
import { ExpenseFormDialog } from '../expense-form-dialog';
import { PayExpenseDialog } from '../pay-expense-dialog';

/** Đề nghị chi: "Của tôi" cho mọi người; "Tất cả" cho người có quyền Xem tài chính (kế toán chi từ đây). */
export function ExpensesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const perms = useFinancePerms();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const effective = perms.view ? scope : 'mine';
  const [status, setStatus] = useState<ExpenseStatus | null>(null);
  const pg = usePageState('finance-expenses', `${effective}-${status}`);
  const { data, isLoading } = useExpenses(effective, status ?? undefined, pg.query);
  const [paying, setPaying] = useState<IExpense | null>(null);
  const all = effective === 'all';
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {perms.view && (
          <Tabs value={scope} onValueChange={(v) => setScope(v as 'mine' | 'all')}>
            <TabsList><TabsTrigger value="mine">Của tôi</TabsTrigger><TabsTrigger value="all">Tất cả</TabsTrigger></TabsList>
          </Tabs>
        )}
        <div className="w-48"><SelectField id="x-status" label="Trạng thái" allowEmpty emptyLabel="Tất cả" value={status} onChange={(v) => setStatus(v as ExpenseStatus | null)}
          options={(Object.keys(EXPENSE_STATUS) as ExpenseStatus[]).map((s) => ({ value: s, label: EXPENSE_STATUS[s].label }))} /></div>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mã</TableHead><TableHead>Ngày gửi</TableHead>{all && <TableHead>Người đề nghị</TableHead>}
              <TableHead className="text-right">Số tiền</TableHead><TableHead>Lý do</TableHead><TableHead>Danh mục · Mảng</TableHead>
              <TableHead>Cần trước</TableHead><TableHead>Trạng thái</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && data?.items.length === 0 && <TableRow><TableCell colSpan={all ? 9 : 8} className="py-8 text-center text-muted-foreground">Chưa có đề nghị chi</TableCell></TableRow>}
            {data?.items.map((x) => (
              <TableRow key={x.id} data-testid="expense-row">
                <TableCell className="font-medium whitespace-nowrap">{x.code}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(x.createdAt.slice(0, 10))}</TableCell>
                {all && <TableCell>{x.requesterName}</TableCell>}
                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatMoney(x.amount)}</TableCell>
                <TableCell className="max-w-xs text-sm">
                  <div className="truncate" title={x.reason}>{x.reason}</div>
                  {x.payee && <div className="truncate text-xs text-muted-foreground">Nhận: {x.payee}</div>}
                  {x.rejectReason && <div className="text-xs text-rose-600">Từ chối: {x.rejectReason}</div>}
                </TableCell>
                <TableCell className="text-sm">{x.categoryName ?? '—'}{x.businessLineName && <div className="text-xs text-muted-foreground">{x.businessLineName}</div>}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(x.neededBy)}</TableCell>
                <TableCell><StatusBadge tone={EXPENSE_STATUS[x.status].tone}>{EXPENSE_STATUS[x.status].label}</StatusBadge></TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {perms.record && x.status === 'Approved' && <Button size="sm" onClick={() => setPaying(x)}>Chi tiền</Button>}
                  {x.status === 'Pending' && <Button size="sm" variant="ghost" asChild><Link to={PATHS.approvals}>Xem luồng duyệt</Link></Button>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="đề nghị" />
      </div>
      <ExpenseFormDialog open={creating} onClose={onCreatedClose} />
      <PayExpenseDialog expense={paying} onClose={() => setPaying(null)} />
    </div>
  );
}
