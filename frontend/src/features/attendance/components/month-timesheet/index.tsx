import { Button } from '@/components/common/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import type { ICorrection, IDay, IMonth } from '../../types/attendance.types';
import { hm, OVERTIME_KIND, WEEKDAY_SHORT, weekdayOf, WORK_MODE } from '../../utils/labels';
import { StatusBadge } from '../status-badge';
import { todayVn } from '@/utils/date';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';

/** Một ô trong khối tổng hợp: nhãn nhỏ, giá trị chính, dòng phụ (đơn vị / chi tiết). */
function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="truncate text-xs text-muted-foreground" title={label}>{label}</div>
      <div className={cn('mt-1 truncate text-lg font-semibold tabular-nums leading-tight', tone)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground" title={sub}>{sub}</div>}
    </div>
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
      {/* gap-px trên nền border = đường kẻ giữa các ô; số cột theo bề rộng khung chứa (dùng được cả trong dialog hẹp) */}
      <div className="@container">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border @md:grid-cols-4 @4xl:grid-cols-8">
          <Stat label="Ngày công" value={`${s.presentDays} / ${s.workDays}`} sub="có mặt / phải làm" />
          <Stat label="Giờ làm" value={hm(s.workedMinutes)} sub={`trên ${hm(s.requiredMinutes)} yêu cầu`} />
          <Stat label="Đi muộn" value={`${s.lateCount} lần`} sub={s.lateMinutes ? `tổng ${s.lateMinutes} phút` : undefined} tone={s.lateCount ? 'text-destructive' : undefined} />
          <Stat label="Vắng" value={`${s.absentDays} ngày`} tone={s.absentDays ? 'text-destructive' : undefined} />
          <Stat label="Thiếu giờ ra" value={`${s.missingCheckoutDays} ngày`} tone={s.missingCheckoutDays ? 'text-warning' : undefined} />
          <Stat label="Hình thức" value={`${s.onsiteDays} · ${s.remoteDays} · ${s.mixedDays}`} sub="VP · Từ xa · KH" />
          <Stat label="Nghỉ phép" value={`${s.leaveDays} ngày`} />
          <Stat label="Tăng ca" value={hm(s.overtimeMinutes)} />
        </div>
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
