import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatMinutes } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDeleteShift, useSaveShift, useShifts } from '../../hooks/useAttendance';
import type { IShift, IUpsertShift } from '../../types/attendance.types';

const blank: IUpsertShift = {
  name: '', type: 'Fixed', startTime: '08:30', endTime: '17:30', graceMinutes: 5, requiredMinutes: 480,
  earliestIn: '07:00', latestIn: '10:00', breakStart: '12:00', breakEnd: '13:30',
};

function ShiftDialog({ shift, onClose }: { shift: IShift | null | undefined; onClose: () => void }) {
  const save = useSaveShift();
  const [f, setF] = useState<IUpsertShift>(blank);
  useEffect(() => {
    if (shift === undefined) return;
    save.reset();
    setF(shift ? { ...blank, ...shift, startTime: shift.startTime ?? blank.startTime, endTime: shift.endTime ?? blank.endTime,
      earliestIn: shift.earliestIn ?? blank.earliestIn, latestIn: shift.latestIn ?? blank.latestIn } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);
  const set = <K extends keyof IUpsertShift>(k: K, v: IUpsertShift[K]) => setF((x) => ({ ...x, [k]: v }));
  const err = fieldErrors(save.error);
  const fixed = f.type === 'Fixed';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: shift?.id, body: { ...f, breakStart: f.breakStart || null, breakEnd: f.breakEnd || null } }, {
      onSuccess: () => { toast.success('Đã lưu ca'); onClose(); },
      onError: (e2) => !Object.keys(fieldErrors(e2)).length && toast.error(errorMessage(e2)),
    });
  };
  return (
    <Dialog open={shift !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{shift ? 'Sửa ca' : 'Thêm ca'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <FormField id="s-name" label="Tên ca *" required value={f.name} onChange={(e) => set('name', e.target.value)} error={err.name} />
          <SelectField id="s-type" label="Loại ca" value={f.type} onChange={(v) => set('type', v as IUpsertShift['type'])}
            options={[{ value: 'Fixed', label: 'Cố định (giờ vào/ra)' }, { value: 'Flexible', label: 'Linh hoạt (đủ số giờ)' }]} />
          {fixed ? (
            <>
              <FormField id="s-start" label="Giờ vào" type="time" value={f.startTime ?? ''} onChange={(e) => set('startTime', e.target.value)} error={err.startTime} />
              <FormField id="s-end" label="Giờ ra" type="time" value={f.endTime ?? ''} onChange={(e) => set('endTime', e.target.value)} error={err.endTime} />
              <FormField id="s-grace" label="Cho phép trễ (phút)" type="number" min={0} max={120} value={f.graceMinutes}
                onChange={(e) => set('graceMinutes', Number(e.target.value))} error={err.graceMinutes} />
            </>
          ) : (
            <>
              <FormField id="s-req" label="Số giờ phải đủ" type="number" step={0.5} min={1} max={16} value={f.requiredMinutes / 60}
                onChange={(e) => set('requiredMinutes', Math.round(Number(e.target.value) * 60))} error={err.requiredMinutes} />
              <div />
              <FormField id="s-ein" label="Vào sớm nhất" type="time" value={f.earliestIn ?? ''} onChange={(e) => set('earliestIn', e.target.value)} />
              <FormField id="s-lin" label="Vào muộn nhất (sau giờ này = đi muộn)" type="time" value={f.latestIn ?? ''} onChange={(e) => set('latestIn', e.target.value)} error={err.latestIn} />
            </>
          )}
          <FormField id="s-bs" label="Bắt đầu nghỉ trưa" type="time" value={f.breakStart ?? ''} onChange={(e) => set('breakStart', e.target.value)} />
          <FormField id="s-be" label="Kết thúc nghỉ trưa" type="time" value={f.breakEnd ?? ''} onChange={(e) => set('breakEnd', e.target.value)} error={err.breakEnd} />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ShiftsPanel() {
  const { data: shifts = [] } = useShifts();
  const remove = useDeleteShift();
  const [editing, setEditing] = useState<IShift | null | undefined>(undefined);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Ca làm</h3>
        <Button size="sm" onClick={() => setEditing(null)}><Plus /> Thêm ca</Button>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Tên ca</TableHead><TableHead>Loại</TableHead><TableHead>Giờ</TableHead><TableHead>Nghỉ trưa</TableHead><TableHead>Phải làm</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {shifts.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.type === 'Fixed' ? 'Cố định' : 'Linh hoạt'}</TableCell>
                <TableCell className="text-sm">{s.type === 'Fixed' ? `${s.startTime}–${s.endTime} (trễ ≤ ${s.graceMinutes}′)` : `Vào ${s.earliestIn ?? '?'}–${s.latestIn ?? '?'}`}</TableCell>
                <TableCell className="text-sm">{s.breakStart ? `${s.breakStart}–${s.breakEnd}` : '—'}</TableCell>
                <TableCell>{formatMinutes(s.plannedMinutes)}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" aria-label="Sửa" onClick={() => setEditing(s)}><Pencil /></Button>
                  <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => confirm(`Xoá ca "${s.name}"?`) &&
                    remove.mutate(s.id, { onSuccess: () => toast.success('Đã xoá ca'), onError: (e) => toast.error(errorMessage(e)) })}><Trash2 /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ShiftDialog shift={editing} onClose={() => setEditing(undefined)} />
    </div>
  );
}
