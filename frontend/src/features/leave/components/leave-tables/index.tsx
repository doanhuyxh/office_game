import { confirmDialog } from '@/components/common/confirm-dialog';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { StatusBadge as Badge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { useCancelApproval } from '@/features/approvals';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useAdjustLeave, useAllBalancesPage, useMyLeavesPage, useTeamLeavesPage } from '../../hooks/useLeave';
import type { IEmployeeBalance, ILeaveRequest } from '../../types/leave.types';
import { fmtDays, LEAVE_STATUS, PERIOD_LABEL } from '../../utils/labels';
import { currentMonthVn } from '@/utils/date';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';

const range = (r: ILeaveRequest) =>
  r.startDate === r.endDate ? `${formatDate(r.startDate)}${r.period !== 'FullDay' ? ` · ${PERIOD_LABEL[r.period]}` : ''}` : `${formatDate(r.startDate)} → ${formatDate(r.endDate)}`;

const StatusBadge = ({ s }: { s: ILeaveRequest['status'] }) => <Badge tone={LEAVE_STATUS[s].tone}>{LEAVE_STATUS[s].label}</Badge>;

/** Đơn nghỉ của tôi; đơn chờ duyệt có nút huỷ (huỷ qua luồng phê duyệt). */
export function MyLeavesTable() {
  const pg = usePageState('my-leaves');
  const { data, isLoading } = useMyLeavesPage(pg.query);
  const rows = data?.items ?? [];
  const cancel = useCancelApproval();
  return (
    <div className="rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Loại</TableHead><TableHead>Thời gian</TableHead><TableHead className="text-right">Số ngày</TableHead>
            <TableHead>Lý do</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-20" /></TableRow>
        </TableHeader>
        <TableBody>
          {isLoading && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
          {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có đơn nghỉ nào</TableCell></TableRow>}
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.leaveTypeName}</TableCell>
              <TableCell className="text-sm">{range(r)}</TableCell>
              <TableCell className="text-right font-mono">{fmtDays(r.days)}</TableCell>
              <TableCell className="max-w-64 text-sm text-muted-foreground">
                {r.reason}{r.rejectReason && <div className="text-destructive">Lý do từ chối: {r.rejectReason}</div>}
              </TableCell>
              <TableCell><StatusBadge s={r.status} /></TableCell>
              <TableCell>
                {r.status === 'Pending' && r.approvalRequestId && (
                  <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={async () => await confirmDialog({ title: 'Huỷ đơn nghỉ này?', confirmText: 'Huỷ đơn', cancelText: 'Không', destructive: true }) &&
                    cancel.mutate(r.approvalRequestId!, { onSuccess: () => toast.success('Đã huỷ đơn'), onError: (e) => toast.error(errorMessage(e)) })}>Huỷ</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination state={pg} total={data?.total} unit="đơn" />
    </div>
  );
}

/** Lịch nghỉ của team trong tháng (quản lý: bản thân + cấp dưới; HR: cả công ty). */
export function TeamCalendar() {
  const [month, setMonth] = useState(currentMonthVn);
  const from = `${month}-01`;
  const to = useMemo(() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }, [month]);
  const pg = usePageState('team-leaves', month);
  const { data, isLoading } = useTeamLeavesPage(from, to, pg.query);
  const rows = data?.items ?? [];
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Input type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Tháng" /></div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Nhân viên</TableHead><TableHead>Loại</TableHead><TableHead>Thời gian</TableHead><TableHead className="text-right">Số ngày</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Không ai nghỉ trong tháng này</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}</TableCell>
                <TableCell>{r.leaveTypeName}</TableCell>
                <TableCell className="text-sm">{range(r)}</TableCell>
                <TableCell className="text-right font-mono">{fmtDays(r.days)}</TableCell>
                <TableCell><StatusBadge s={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="đơn" />
      </div>
    </div>
  );
}

/** HR: số dư phép năm của mọi người + điều chỉnh tay. */
const BALANCE_COLUMNS: ColumnDef[] = [
  { id: 'employee', label: 'Nhân viên', required: true }, { id: 'accrued', label: 'Tích luỹ năm nay' }, { id: 'carried', label: 'Chuyển từ năm trước' },
  { id: 'adjusted', label: 'Điều chỉnh' }, { id: 'used', label: 'Đã nghỉ' }, { id: 'pending', label: 'Chờ duyệt' }, { id: 'available', label: 'Còn lại' },
];

export function BalancesTable() {
  const pg = usePageState('leave-balances');
  const { data, isLoading } = useAllBalancesPage(pg.query);
  const rows = data?.items ?? [];
  const cols = useColumns('leave-balances', BALANCE_COLUMNS);
  const v = cols.show;
  const adjust = useAdjustLeave();
  const [target, setTarget] = useState<IEmployeeBalance | null>(null);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const errors = fieldErrors(adjust.error);
  const open = (r: IEmployeeBalance) => { adjust.reset(); setDays(''); setReason(''); setTarget(r); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    adjust.mutate({ employeeId: target.employee.id, days: Number(days), reason }, {
      onSuccess: () => { toast.success('Đã điều chỉnh phép năm'); setTarget(null); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <>
      <div className="mb-2 flex justify-end"><ColumnsMenu state={cols} /></div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nhân viên</TableHead>{v('accrued') && <TableHead className="text-right">Tích luỹ năm nay</TableHead>}{v('carried') && <TableHead className="text-right">Chuyển từ năm trước</TableHead>}
              {v('adjusted') && <TableHead className="text-right">Điều chỉnh</TableHead>}{v('used') && <TableHead className="text-right">Đã nghỉ</TableHead>}{v('pending') && <TableHead className="text-right">Chờ duyệt</TableHead>}
              {v('available') && <TableHead className="text-right">Còn lại</TableHead>}<TableHead className="w-24" /></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={cols.span(1)} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.employee.id}>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}</TableCell>
                {v('accrued') && <TableCell className="text-right font-mono">{fmtDays(r.balance.accruedThisYear)}</TableCell>}
                {v('carried') && <TableCell className="text-right font-mono">{fmtDays(r.balance.carriedFromPreviousYears)}</TableCell>}
                {v('adjusted') && <TableCell className="text-right font-mono">{fmtDays(r.balance.adjustedThisYear)}</TableCell>}
                {v('used') && <TableCell className="text-right font-mono">{fmtDays(r.balance.usedThisYear)}</TableCell>}
                {v('pending') && <TableCell className="text-right font-mono">{fmtDays(r.balance.pending)}</TableCell>}
                {v('available') && <TableCell className="text-right font-mono font-semibold">{fmtDays(r.balance.available)}</TableCell>}
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => open(r)}>Điều chỉnh</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="nhân viên" />
      </div>
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Điều chỉnh phép năm: {target?.employee.fullName}</DialogTitle>
            <DialogDescription>Số dương để cộng, số âm để trừ (bội số 0,5). Không sửa / xoá được — nhập sai thì thêm điều chỉnh ngược lại.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <FormField id="adj-days" label="Số ngày" type="number" step={0.5} required value={days} onChange={(e) => setDays(e.target.value)} error={errors.days} />
            <FormField id="adj-reason" label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason}
              placeholder="Vd: Số dư chuyển từ Excel năm 2025" />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTarget(null)}>Huỷ</Button>
              <Button type="submit" disabled={adjust.isPending}>Lưu</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
