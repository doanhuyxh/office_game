import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { useCancelApproval } from '@/features/approvals';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useAdjustLeave, useAllBalances, useMyLeaves, useTeamLeaves } from '../hooks/useLeave';
import type { IEmployeeBalance, ILeaveRequest } from '../types/leave.types';
import { fmtDays, LEAVE_STATUS, PERIOD_LABEL } from '../utils/labels';

const range = (r: ILeaveRequest) =>
  r.startDate === r.endDate ? `${formatDate(r.startDate)}${r.period !== 'FullDay' ? ` · ${PERIOD_LABEL[r.period]}` : ''}` : `${formatDate(r.startDate)} → ${formatDate(r.endDate)}`;

const StatusBadge = ({ s }: { s: ILeaveRequest['status'] }) => (
  <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', LEAVE_STATUS[s].className)}>{LEAVE_STATUS[s].label}</span>
);

/** Đơn nghỉ của tôi; đơn chờ duyệt có nút huỷ (huỷ qua luồng phê duyệt). */
export function MyLeavesTable() {
  const { data: rows = [], isLoading } = useMyLeaves();
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
                {r.reason}{r.rejectReason && <div className="text-red-600">Lý do từ chối: {r.rejectReason}</div>}
              </TableCell>
              <TableCell><StatusBadge s={r.status} /></TableCell>
              <TableCell>
                {r.status === 'Pending' && r.approvalRequestId && (
                  <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => confirm('Huỷ đơn nghỉ này?') &&
                    cancel.mutate(r.approvalRequestId!, { onSuccess: () => toast.success('Đã huỷ đơn'), onError: (e) => toast.error(errorMessage(e)) })}>Huỷ</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Lịch nghỉ của team trong tháng (quản lý: bản thân + cấp dưới; HR: cả công ty). */
export function TeamCalendar() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7));
  const from = `${month}-01`;
  const to = useMemo(() => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }, [month]);
  const { data: rows = [], isLoading } = useTeamLeaves(from, to);
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
      </div>
    </div>
  );
}

/** HR: số dư phép năm của mọi người + điều chỉnh tay. */
export function BalancesTable() {
  const { data: rows = [], isLoading } = useAllBalances(true);
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
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nhân viên</TableHead><TableHead className="text-right">Tích luỹ năm nay</TableHead><TableHead className="text-right">Chuyển từ năm trước</TableHead>
              <TableHead className="text-right">Điều chỉnh</TableHead><TableHead className="text-right">Đã nghỉ</TableHead><TableHead className="text-right">Chờ duyệt</TableHead>
              <TableHead className="text-right">Còn lại</TableHead><TableHead className="w-24" /></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.employee.id}>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}</TableCell>
                <TableCell className="text-right font-mono">{fmtDays(r.balance.accruedThisYear)}</TableCell>
                <TableCell className="text-right font-mono">{fmtDays(r.balance.carriedFromPreviousYears)}</TableCell>
                <TableCell className="text-right font-mono">{fmtDays(r.balance.adjustedThisYear)}</TableCell>
                <TableCell className="text-right font-mono">{fmtDays(r.balance.usedThisYear)}</TableCell>
                <TableCell className="text-right font-mono">{fmtDays(r.balance.pending)}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{fmtDays(r.balance.available)}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => open(r)}>Điều chỉnh</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
