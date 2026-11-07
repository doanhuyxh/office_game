import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { formatDate, formatTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreateCorrection } from '../hooks/useAttendance';
import type { IDay, ICreateCorrection } from '../types/attendance.types';

/** Giải trình một ngày: khai giờ vào hoặc giờ ra thực tế. Duyệt xong bảng công tự cập nhật. */
export function CorrectionDialog({ day, onClose }: { day: IDay | null; onClose: () => void }) {
  const create = useCreateCorrection();
  const [f, setF] = useState<ICreateCorrection>({ workDate: '', type: 'Out', time: '17:30', workMode: 'Onsite', reason: '' });
  useEffect(() => {
    if (!day) return;
    create.reset();
    // Gợi ý: đã có giờ vào mà thiếu giờ ra → khai giờ ra; chưa có gì → khai giờ vào.
    setF({ workDate: day.date, type: day.firstIn && !day.lastOut ? 'Out' : day.firstIn ? 'Out' : 'In', time: day.firstIn ? '17:30' : '08:30', workMode: 'Onsite', reason: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day?.date]);
  const errors = fieldErrors(create.error);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(f, {
      onSuccess: () => { toast.success('Đã gửi giải trình, chờ duyệt'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={!!day} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Giải trình chấm công {day && formatDate(day.date)}</DialogTitle>
          <DialogDescription>
            {day?.sessions.length
              ? `Đã ghi nhận: ${day.sessions.map((s) => `${formatTime(s.in)}–${s.out ? formatTime(s.out) : '?'}`).join(', ')}`
              : 'Chưa có lần chấm công nào trong ngày'}. Đơn được quản lý rồi HR duyệt.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectField id="corr-type" label="Bổ sung" value={f.type} onChange={(v) => setF({ ...f, type: (v ?? 'In') as 'In' | 'Out' })} error={errors.type}
              options={[{ value: 'In', label: 'Giờ vào' }, { value: 'Out', label: 'Giờ ra' }]} />
            <FormField id="corr-time" label="Giờ thực tế" type="time" required value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} error={errors.time} />
          </div>
          <SelectField id="corr-mode" label="Hình thức" value={f.workMode} onChange={(v) => setF({ ...f, workMode: (v ?? 'Onsite') as 'Onsite' | 'Remote' })} error={errors.workMode}
            options={[{ value: 'Onsite', label: '🏢 Tại văn phòng' }, { value: 'Remote', label: '🏠 Từ xa' }]} />
          <div className="grid gap-2">
            <Label htmlFor="corr-reason">Lý do *</Label>
            <Textarea id="corr-reason" rows={2} maxLength={500} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Vd: Quên bấm chấm công ra" />
            {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
            {errors.workDate && <p className="text-xs text-destructive">{errors.workDate}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending}>Gửi giải trình</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
