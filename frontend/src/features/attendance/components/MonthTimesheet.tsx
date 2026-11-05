import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import type { IMonth } from '../types/attendance.types';
import { hm, WEEKDAY_SHORT, weekdayOf, WORK_MODE } from '../utils/labels';
import { StatusBadge } from './StatusBadge';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="py-3">
      <CardHeader className="px-4 py-0"><CardDescription>{label}</CardDescription><CardTitle className={cn('text-xl', tone)}>{value}</CardTitle></CardHeader>
    </Card>
  );
}

/** Bảng công một tháng của một nhân viên + tổng hợp. */
export function MonthTimesheet({ data }: { data: IMonth }) {
  const s = data.summary;
  const days = data.days.filter((d) => d.status !== 'NotEmployed');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Ngày công" value={`${s.presentDays}/${s.workDays}`} />
        <Stat label="Giờ làm" value={`${hm(s.workedMinutes)} / ${hm(s.requiredMinutes)}`} />
        <Stat label="Đi muộn" value={s.lateCount ? `${s.lateCount} lần · ${s.lateMinutes}′` : 0} tone={s.lateCount ? 'text-red-600' : undefined} />
        <Stat label="Vắng" value={s.absentDays} tone={s.absentDays ? 'text-red-600' : undefined} />
        <Stat label="Thiếu giờ ra" value={s.missingCheckoutDays} tone={s.missingCheckoutDays ? 'text-amber-600' : undefined} />
        <Stat label="VP / Từ xa / KH" value={`${s.onsiteDays} / ${s.remoteDays} / ${s.mixedDays}`} />
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead><TableHead>Ca</TableHead><TableHead>Vào</TableHead><TableHead>Ra</TableHead>
              <TableHead className="text-right">Giờ làm</TableHead><TableHead className="text-right">Muộn</TableHead>
              <TableHead className="text-right">Thiếu</TableHead><TableHead>Hình thức</TableHead><TableHead>Trạng thái</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => {
              const wd = weekdayOf(d.date);
              return (
                <TableRow key={d.date} className={cn((wd === 0 || wd === 6) && 'bg-muted/40')}>
                  <TableCell className="font-mono text-xs">{WEEKDAY_SHORT[wd]} {d.date.slice(8)}/{d.date.slice(5, 7)}</TableCell>
                  <TableCell className="text-xs">{d.holidayName ?? d.shiftName ?? '—'}</TableCell>
                  <TableCell className="font-mono tabular-nums">{d.firstIn ? formatTime(d.firstIn) : ''}</TableCell>
                  <TableCell className="font-mono tabular-nums">{d.lastOut ? formatTime(d.lastOut) : ''}{d.sessions.length > 1 && <span className="ml-1 text-xs text-muted-foreground">({d.sessions.length} lần)</span>}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{hm(d.workedMinutes)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', d.lateMinutes > 0 && 'text-red-600')}>{d.lateMinutes || ''}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', d.shortMinutes > 0 && 'text-amber-600')}>{d.shortMinutes || ''}</TableCell>
                  <TableCell className="text-xs">{d.workMode ? WORK_MODE[d.workMode] : ''}</TableCell>
                  <TableCell><StatusBadge status={d.status} /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function MonthTimesheetCard({ data, title }: { data: IMonth; title?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title ?? `${data.employee.code} · ${data.employee.fullName}`}</CardTitle></CardHeader>
      <CardContent><MonthTimesheet data={data} /></CardContent>
    </Card>
  );
}
