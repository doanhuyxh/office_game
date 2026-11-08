import { confirmDialog } from '@/components/common/confirm-dialog';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { useEmployees } from '@/features/employees';
import { formatDate } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useDeleteSchedule, useSaveSchedule, useSchedulesPage, useShifts } from '../../hooks/useAttendance';
import type { ISchedule, IWeekDay } from '../../types/attendance.types';
import { WEEKDAY_LONG, WEEKDAY_SHORT } from '../../utils/labels';
import { todayVn } from '@/utils/date';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // hiển thị T2 → CN
const todayStr = todayVn;

/** Sửa lịch tuần: công ty (employeeId = null) hoặc riêng một nhân viên, hiệu lực từ một ngày. */
function ScheduleDialog({ initial, onClose }: { initial: ISchedule | 'new-employee' | null; onClose: () => void }) {
  const { data: shifts = [] } = useShifts();
  const { data: employees = [] } = useEmployees();
  const save = useSaveSchedule();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [from, setFrom] = useState(todayStr());
  const [days, setDays] = useState<IWeekDay[]>([]);
  const open = initial !== null;
  const isCompany = initial !== 'new-employee' && initial?.employeeId == null;

  useEffect(() => {
    if (!initial) return;
    save.reset();
    if (initial === 'new-employee') {
      setEmployeeId(null); setFrom(todayStr());
      setDays([0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, shiftId: d >= 1 && d <= 5 ? shifts[0]?.id ?? null : null })));
    } else {
      setEmployeeId(initial.employeeId); setFrom(initial.effectiveFrom < todayStr() ? todayStr() : initial.effectiveFrom); setDays(initial.days);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const submit = () => {
    if (initial === 'new-employee' && !employeeId) return toast.error('Chọn nhân viên');
    save.mutate({ employeeId: isCompany ? null : employeeId, effectiveFrom: from, days }, {
      onSuccess: () => { toast.success('Đã lưu lịch làm việc'); onClose(); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCompany ? 'Lịch làm việc của công ty' : initial === 'new-employee' ? 'Lịch riêng cho nhân viên' : `Lịch riêng: ${(initial as ISchedule).employeeName}`}</DialogTitle>
          <DialogDescription>Áp dụng từ ngày chọn trở đi. Bảng công những ngày trước đó không bị thay đổi.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {initial === 'new-employee' && (
            <SearchSelectField id="sch-emp" label="Nhân viên" value={employeeId} onChange={setEmployeeId}
              options={employees.map((e) => ({ value: e.id, label: `${e.code} · ${e.fullName}` }))} />
          )}
          <FormField id="sch-from" label="Áp dụng từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          {ORDER.map((d) => (
            <div key={d} className="grid grid-cols-[90px_1fr] items-center gap-3">
              <span className="text-sm">{WEEKDAY_LONG[d]}</span>
              <SelectField id={`sch-d${d}`} label="" allowEmpty emptyLabel="Nghỉ" value={days.find((x) => x.dayOfWeek === d)?.shiftId ?? null}
                onChange={(v) => setDays((all) => all.map((x) => (x.dayOfWeek === d ? { ...x, shiftId: v } : x)))}
                options={shifts.map((s) => ({ value: s.id, label: s.name }))} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button onClick={submit} disabled={save.isPending}>Lưu lịch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SchedulesPanel() {
  const pg = usePageState('schedules');
  const { data } = useSchedulesPage(pg.query);
  const schedules = data?.items ?? [];
  const { data: shifts = [] } = useShifts();
  const remove = useDeleteSchedule();
  const [editing, setEditing] = useState<ISchedule | 'new-employee' | null>(null);
  const shiftName = (id: string | null) => (id ? shifts.find((s) => s.id === id)?.name ?? '?' : 'Nghỉ');
  const today = todayStr();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Lịch làm việc theo tuần</h3>
          <p className="text-xs text-muted-foreground">Nhân viên không có lịch riêng dùng lịch công ty.</p>
        </div>
        <Button size="sm" onClick={() => setEditing('new-employee')}><Plus /> Lịch riêng cho nhân viên</Button>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Áp dụng cho</TableHead><TableHead>Từ ngày</TableHead>
              {ORDER.map((d) => <TableHead key={d}>{WEEKDAY_SHORT[d]}</TableHead>)}<TableHead className="w-28" /></TableRow>
          </TableHeader>
          <TableBody>
            {schedules.map((s) => (
              <TableRow key={`${s.employeeId}-${s.effectiveFrom}`}>
                <TableCell className="font-medium">{s.employeeName ?? '🏢 Cả công ty'}</TableCell>
                <TableCell className="text-xs">{s.effectiveFrom <= today ? 'Đang áp dụng' : `Từ ${formatDate(s.effectiveFrom)}`}</TableCell>
                {ORDER.map((d) => {
                  const id = s.days.find((x) => x.dayOfWeek === d)?.shiftId ?? null;
                  return <TableCell key={d} className={id ? 'text-xs' : 'text-xs text-muted-foreground'}>{shiftName(id)}</TableCell>;
                })}
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>Sửa</Button>
                  {s.employeeId && (
                    <Button variant="ghost" size="icon" aria-label="Bỏ lịch riêng" onClick={async () => await confirmDialog({ title: 'Bỏ lịch riêng?', description: 'Nhân viên quay về lịch làm việc chung của công ty.', confirmText: 'Bỏ lịch riêng', destructive: true }) &&
                      remove.mutate({ employeeId: s.employeeId, effectiveFrom: s.effectiveFrom }, { onError: (e) => toast.error(errorMessage(e)) })}><Trash2 /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="lịch" />
      </div>
      <ScheduleDialog initial={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
