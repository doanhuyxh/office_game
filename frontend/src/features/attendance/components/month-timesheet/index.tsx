import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import type { ICorrection, IDay, IMonth } from '../../types/attendance.types';
import { hm, OVERTIME_KIND, WEEKDAY_SHORT, weekdayOf, WORK_MODE } from '../../utils/labels';
import { StatusBadge } from '../status-badge';
import { todayVn } from '@/utils/date';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <Card className="gap-0 py-3">
      <CardHeader className="gap-1 px-4"><CardDescription>{label}</CardDescription><CardTitle className={cn('text-xl', tone)}>{value}</CardTitle></CardHeader>
    </Card>
  );
}

const TIMESHEET_COLUMNS: ColumnDef[] = [
  { id: 'date', label: 'Ngày', required: true }, { id: 'shift', label: 'Ca' }, { id: 'in', label: 'Vào' }, { id: 'out', label: 'Ra' },
  { id: 'worked', label: 'Giờ làm' }, { id: 'late', label: 'Muộn' }, { id: 'short', label: 'Thiếu' }, { id: 'overtime', label: 'Tăng ca' },
  { id: 'mode', label: 'Hình thức' }, { id: 'status', label: 'Trạng thái' },
];

const CORRECTION_LABEL: Record<ICorrection['status'], string> = { Pending: '⏳ chờ duyệt', Approved: '✓ đã duyệt', Rejected: '✕ bị từ chối', Cancelled: 'đã huỷ' };

/** Ngày được phép giải trình: trong 31 ngày gần nhất, không phải tương lai (khớp CorrectionEndpoints.MaxDaysBack). */
const canCorrect = (d: IDay) => {
  const today = todayVn();
  const min = new Date(Date.parse(today) - 31 * 864e5).toISOString().slice(0, 10);
  return d.date <= today && d.date >= min && d.status !== 'NotEmployed' && d.status !== 'NotYet';
};

/**
 * Bảng công một tháng của một nhân viên + tổng hợp.
 * Truyền `onCorrect` (bảng công của chính mình) để hiện nút "Giải trình"; `corrections` để hiện trạng thái giải trình theo ngày.
 */
export function MonthTimesheet({ data, onCorrect, corrections = [] }: { data: IMonth; onCorrect?: (day: IDay) => void; corrections?: ICorrection[] }) {
  const s = data.summary;
  const days = data.days.filter((d) => d.status !== 'NotEmployed');
  const cols = useColumns('attendance-timesheet', TIMESHEET_COLUMNS);
  const v = cols.show;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label="Ngày công" value={`${s.presentDays}/${s.workDays}`} />
        <Stat label="Giờ làm" value={`${hm(s.workedMinutes)} / ${hm(s.requiredMinutes)}`} />
        <Stat label="Đi muộn" value={s.lateCount ? `${s.lateCount} lần · ${s.lateMinutes}′` : 0} tone={s.lateCount ? 'text-destructive' : undefined} />
        <Stat label="Vắng" value={s.absentDays} tone={s.absentDays ? 'text-destructive' : undefined} />
        <Stat label="Thiếu giờ ra" value={s.missingCheckoutDays} tone={s.missingCheckoutDays ? 'text-warning' : undefined} />
        <Stat label="VP / Từ xa / KH" value={`${s.onsiteDays} / ${s.remoteDays} / ${s.mixedDays}`} />
        <Stat label="Nghỉ phép" value={s.leaveDays} />
        <Stat label="Tăng ca" value={hm(s.overtimeMinutes)} />
      </div>
      <div className="flex justify-end"><ColumnsMenu state={cols} /></div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead>{v('shift') && <TableHead>Ca</TableHead>}{v('in') && <TableHead>Vào</TableHead>}{v('out') && <TableHead>Ra</TableHead>}
              {v('worked') && <TableHead className="text-right">Giờ làm</TableHead>}{v('late') && <TableHead className="text-right">Muộn</TableHead>}
              {v('short') && <TableHead className="text-right">Thiếu</TableHead>}{v('overtime') && <TableHead className="text-right">Tăng ca</TableHead>}{v('mode') && <TableHead>Hình thức</TableHead>}{v('status') && <TableHead>Trạng thái</TableHead>}
              {onCorrect && <TableHead className="w-28" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => {
              const wd = weekdayOf(d.date);
              return (
                <TableRow key={d.date} className={cn((wd === 0 || wd === 6) && 'bg-muted/40')}>
                  <TableCell className="font-mono text-xs">{WEEKDAY_SHORT[wd]} {d.date.slice(8)}/{d.date.slice(5, 7)}</TableCell>
                  {v('shift') && (
                    <TableCell className="text-xs">
                      {d.holidayName ?? d.shiftName ?? '—'}
                      {d.leaveName && <div className="text-info">{d.leaveFraction < 1 ? '½ ' : ''}{d.leaveName}</div>}
                    </TableCell>
                  )}
                  {v('in') && <TableCell className="font-mono tabular-nums">{d.firstIn ? formatTime(d.firstIn) : ''}</TableCell>}
                  {v('out') && <TableCell className="font-mono tabular-nums">{d.lastOut ? formatTime(d.lastOut) : ''}{d.sessions.length > 1 && <span className="ml-1 text-xs text-muted-foreground">({d.sessions.length} lần)</span>}</TableCell>}
                  {v('worked') && <TableCell className="text-right font-mono tabular-nums">{hm(d.workedMinutes)}</TableCell>}
                  {v('late') && <TableCell className={cn('text-right tabular-nums', d.lateMinutes > 0 && 'text-destructive')}>{d.lateMinutes || ''}</TableCell>}
                  {v('short') && <TableCell className={cn('text-right tabular-nums', d.shortMinutes > 0 && 'text-warning')}>{d.shortMinutes || ''}</TableCell>}
                  {v('overtime') && (
                    <TableCell className="text-right font-mono text-xs tabular-nums" title={d.overtimeKind ? OVERTIME_KIND[d.overtimeKind].label : undefined}>
                      {d.overtimeMinutes > 0 && <>{hm(d.overtimeMinutes)} <span className="text-muted-foreground">{d.overtimeKind && OVERTIME_KIND[d.overtimeKind].short}</span></>}
                    </TableCell>
                  )}
                  {v('mode') && <TableCell className="text-xs">{d.workMode ? WORK_MODE[d.workMode] : ''}</TableCell>}
                  {v('status') && <TableCell>
                    <StatusBadge status={d.status} />
                    {corrections.filter((c) => c.workDate === d.date).map((c) => (
                      <div key={c.id} className="mt-1 text-xs text-muted-foreground">Giải trình {c.type === 'In' ? 'vào' : 'ra'} {c.time} {CORRECTION_LABEL[c.status]}</div>
                    ))}
                  </TableCell>}
                  {onCorrect && (
                    <TableCell className="text-right">
                      {canCorrect(d) && <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onCorrect(d)} data-testid={`correct-${d.date}`}>Giải trình</Button>}
                    </TableCell>
                  )}
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
