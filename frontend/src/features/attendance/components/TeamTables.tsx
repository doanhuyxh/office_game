import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { useBoard, useEmployeeMonth, useReport } from '../hooks/useAttendance';
import type { DayStatus, IEmployeeBrief } from '../types/attendance.types';
import { hm, WORK_MODE } from '../utils/labels';
import { MonthTimesheet } from './MonthTimesheet';
import { StatusBadge } from './StatusBadge';

/** Tình trạng chấm công hôm nay của cả công ty (HR) / cấp dưới (quản lý). */
export function BoardTable() {
  const { data: rows = [], isLoading } = useBoard();
  const order: Record<DayStatus, number> = { Working: 0, Present: 1, MissingCheckout: 2, NotYet: 3, Leave: 4, Absent: 5, Holiday: 6, DayOff: 7, NotEmployed: 8 };
  const sorted = [...rows].sort((a, b) => order[a.day.status] - order[b.day.status] || a.employee.code.localeCompare(b.employee.code));
  const count = (s: string) => rows.filter((r) => r.day.status === s).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Đang làm <b>{count('Working')}</b> · Đã xong <b>{count('Present')}</b> · Chưa chấm <b>{count('NotYet')}</b> · Nghỉ phép <b>{count('Leave')}</b> · Vắng <b>{count('Absent')}</b>
      </p>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nhân viên</TableHead><TableHead>Phòng ban</TableHead><TableHead>Vào</TableHead><TableHead>Ra</TableHead>
              <TableHead className="text-right">Giờ làm</TableHead><TableHead className="text-right">Muộn</TableHead><TableHead>Hình thức</TableHead><TableHead>Trạng thái</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Chưa có nhân viên</TableCell></TableRow>}
            {sorted.map(({ employee: e, day: d }) => (
              <TableRow key={e.id}>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{e.code}</span> {e.fullName}</TableCell>
                <TableCell>{e.departmentName ?? '—'}</TableCell>
                <TableCell className="font-mono tabular-nums">{d.firstIn ? formatTime(d.firstIn) : ''}</TableCell>
                <TableCell className="font-mono tabular-nums">{d.lastOut ? formatTime(d.lastOut) : ''}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{hm(d.workedMinutes)}</TableCell>
                <TableCell className={cn('text-right', d.lateMinutes > 0 && 'text-destructive')}>{d.lateMinutes || ''}</TableCell>
                <TableCell className="text-xs">{d.workMode ? WORK_MODE[d.workMode] : ''}</TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Tổng hợp tháng từng nhân viên; bấm một dòng để xem bảng công chi tiết. */
export function ReportTable({ month }: { month: string }) {
  const { data: rows = [], isLoading } = useReport(month);
  const [selected, setSelected] = useState<IEmployeeBrief | null>(null);
  const detail = useEmployeeMonth(selected?.id ?? null, month);
  return (
    <>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nhân viên</TableHead><TableHead className="text-right">Ngày công</TableHead><TableHead className="text-right">Giờ làm</TableHead>
              <TableHead className="text-right">Đi muộn</TableHead><TableHead className="text-right">Vắng</TableHead><TableHead className="text-right">Thiếu giờ ra</TableHead>
              <TableHead className="text-right">Tăng ca</TableHead><TableHead className="text-right">VP / Từ xa / KH</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {rows.map(({ employee: e, summary: s }) => (
              <TableRow key={e.id} className="cursor-pointer" onClick={() => setSelected(e)}>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{e.code}</span> {e.fullName}</TableCell>
                <TableCell className="text-right">{s.presentDays}/{s.workDays}</TableCell>
                <TableCell className="text-right font-mono">{hm(s.workedMinutes)} / {hm(s.requiredMinutes)}</TableCell>
                <TableCell className={cn('text-right', s.lateCount > 0 && 'text-destructive')}>{s.lateCount ? `${s.lateCount} (${s.lateMinutes}′)` : 0}</TableCell>
                <TableCell className={cn('text-right', s.absentDays > 0 && 'text-destructive')}>{s.absentDays}</TableCell>
                <TableCell className={cn('text-right', s.missingCheckoutDays > 0 && 'text-warning')}>{s.missingCheckoutDays}</TableCell>
                <TableCell className="text-right font-mono" title={`Ngày thường ${hm(s.overtimeWeekdayMinutes)} · nghỉ tuần ${hm(s.overtimeRestDayMinutes)} · lễ ${hm(s.overtimeHolidayMinutes)}`}>
                  {hm(s.overtimeMinutes)}
                </TableCell>
                <TableCell className="text-right">{s.onsiteDays} / {s.remoteDays} / {s.mixedDays}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader><DialogTitle>{selected?.code} · {selected?.fullName} · tháng {month.slice(5)}/{month.slice(0, 4)}</DialogTitle></DialogHeader>
          {detail.data ? <MonthTimesheet data={detail.data} /> : <p className="text-sm text-muted-foreground">Đang tải…</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
