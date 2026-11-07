import { useEffect, useState } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Textarea } from '@/components/common/textarea';
import { useCancelApproval } from '@/features/approvals';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreateOvertime, useMyMonth, useMyOvertimePage, useOvertimePreview } from '../hooks/useAttendance';
import type { ICreateOvertime } from '../types/attendance.types';
import { currentMonth, hm, OVERTIME_KIND, OVERTIME_STATUS } from '../utils/labels';
import { todayVn } from '@/utils/date';

const today = todayVn;
/** 150 → "2,5 giờ" */
const hours = (min: number) => `${(Math.round((min / 60) * 100) / 100).toLocaleString('vi-VN')} giờ`;

/** Đăng ký trước hoặc khai bù (≤ 7 ngày) một khoảng tăng ca. Server xem trước số giờ, loại ngày và cảnh báo vượt giới hạn. */
function OvertimeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateOvertime();
  const [f, setF] = useState<ICreateOvertime>({ workDate: today(), startTime: '18:00', endTime: '20:00', reason: '' });
  useEffect(() => {
    if (!open) return;
    create.reset();
    setF({ workDate: today(), startTime: '18:00', endTime: '20:00', reason: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounce một chuỗi (không phải object) để effect của useDebounce không chạy lại ở mỗi lần render.
  const [workDate, startTime, endTime] = useDebounce(`${f.workDate}|${f.startTime}|${f.endTime}`, 300).split('|');
  const preview = useOvertimePreview({ workDate, startTime, endTime }, open);
  // Lỗi khi gửi ưu tiên hơn lỗi xem trước (cùng field).
  const errors = { ...fieldErrors(preview.error), ...fieldErrors(create.error) };
  const p = preview.data;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(f, {
      onSuccess: (r) => {
        toast.success('Đã gửi đơn tăng ca, chờ duyệt');
        r.warnings.forEach((w) => toast.warning(w));
        onClose();
      },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Đăng ký tăng ca</DialogTitle>
          <DialogDescription>Đăng ký trước, hoặc khai bù trong 7 ngày. Được quản lý rồi HR duyệt thì số giờ trên đơn được tính vào công.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FormField id="ot-date" label="Ngày" type="date" required value={f.workDate} onChange={(e) => setF({ ...f, workDate: e.target.value })} error={errors.workDate} />
          <div className="grid grid-cols-2 gap-3">
            <FormField id="ot-start" label="Từ" type="time" required value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} error={errors.startTime} />
            <FormField id="ot-end" label="Đến" type="time" required value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} error={errors.endTime} />
          </div>
          {p && !preview.isError && (
            <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm" data-testid="overtime-preview">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b>{hours(p.minutes)}</b> tăng ca</span>
                <StatusBadge tone={OVERTIME_KIND[p.kind].tone}>{OVERTIME_KIND[p.kind].label}</StatusBadge>
              </div>
              <p className="text-xs text-muted-foreground">
                Đã đăng ký trong tháng: {hours(p.monthMinutes)} · trong năm: {hours(p.yearMinutes)} (gồm đơn đang chờ)
              </p>
              {p.warnings.map((w) => (
                <p key={w} className="flex gap-1.5 text-xs text-warning"><AlertTriangle className="mt-px size-3.5 shrink-0" />{w}</p>
              ))}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="ot-reason">Lý do *</Label>
            <Textarea id="ot-reason" rows={2} maxLength={500} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}
              placeholder="Vd: Hoàn thành báo cáo quý cho khách hàng" />
            {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending}>Gửi đơn</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="gap-0 py-3">
      <CardHeader className="gap-1 px-4"><CardDescription>{label}</CardDescription><CardTitle className="text-xl">{value}</CardTitle></CardHeader>
    </Card>
  );
}

/** Tab "Tăng ca": tổng giờ đã duyệt theo loại ngày trong tháng + danh sách đơn của tôi (huỷ được khi đang chờ). */
export function OvertimeTab() {
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const pg = usePageState('my-overtime', month);
  const { data, isLoading } = useMyOvertimePage(month, pg.query);
  const rows = data?.items ?? [];
  const { data: monthData } = useMyMonth(month);
  const cancel = useCancelApproval();
  const s = monthData?.summary;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" aria-label="Chọn tháng" />
        <Button onClick={() => setOpen(true)} data-testid="overtime-new"><Plus /> Đăng ký tăng ca</Button>
      </div>
      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tổng đã duyệt" value={hm(s.overtimeMinutes)} />
          <Stat label="Ngày thường · 150%" value={hm(s.overtimeWeekdayMinutes)} />
          <Stat label="Ngày nghỉ tuần · 200%" value={hm(s.overtimeRestDayMinutes)} />
          <Stat label="Ngày lễ · 300%" value={hm(s.overtimeHolidayMinutes)} />
        </div>
      )}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Ngày</TableHead><TableHead>Giờ</TableHead><TableHead className="text-right">Số giờ</TableHead><TableHead>Loại ngày</TableHead>
              <TableHead>Lý do</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-20" /></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có đơn tăng ca trong tháng</TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.workDate)}</TableCell>
                <TableCell className="font-mono tabular-nums">{r.startTime}–{r.endTime}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{hm(r.minutes)}</TableCell>
                <TableCell><StatusBadge tone={OVERTIME_KIND[r.kind].tone}>{OVERTIME_KIND[r.kind].label}</StatusBadge></TableCell>
                <TableCell className="max-w-64 text-sm text-muted-foreground">
                  {r.reason}{r.rejectReason && <div className="text-destructive">Lý do từ chối: {r.rejectReason}</div>}
                </TableCell>
                <TableCell><StatusBadge tone={OVERTIME_STATUS[r.status].tone}>{OVERTIME_STATUS[r.status].label}</StatusBadge></TableCell>
                <TableCell>
                  {r.status === 'Pending' && r.approvalRequestId && (
                    <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => confirm('Huỷ đơn tăng ca này?') &&
                      cancel.mutate(r.approvalRequestId!, { onSuccess: () => toast.success('Đã huỷ đơn'), onError: (e) => toast.error(errorMessage(e)) })}>Huỷ</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="đơn" />
      </div>
      <OvertimeDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
