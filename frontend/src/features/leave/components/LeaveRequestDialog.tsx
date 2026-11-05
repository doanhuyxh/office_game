import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreateLeave, useLeavePreview, useLeaveTypes, useMyBalance } from '../hooks/useLeave';
import type { LeavePeriod } from '../types/leave.types';
import { fmtDays, PERIOD_LABEL, todayStr } from '../utils/labels';

/** Form xin nghỉ: loại, khoảng ngày, buổi (chỉ khi 1 ngày), lý do. Hiện trước số ngày làm việc bị trừ (theo lịch ca). */
export function LeaveRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: types = [] } = useLeaveTypes();
  const { data: balance } = useMyBalance();
  const create = useCreateLeave();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(todayStr());
  const [period, setPeriod] = useState<LeavePeriod>('FullDay');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    create.reset();
    setTypeId(types[0]?.id ?? null); setStart(todayStr()); setEnd(todayStr()); setPeriod('FullDay'); setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { if (!typeId && types.length) setTypeId(types[0].id); }, [types, typeId]);

  const singleDay = start === end;
  const effectivePeriod = singleDay ? period : 'FullDay';
  const [pStart, pEnd] = [useDebounce(start, 300), useDebounce(end, 300)];
  const preview = useLeavePreview(pStart, pEnd, effectivePeriod);
  const type = types.find((t) => t.id === typeId);
  const errors = fieldErrors(create.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typeId) return;
    create.mutate({ leaveTypeId: typeId, startDate: start, endDate: end, period: effectivePeriod, reason: reason || undefined }, {
      onSuccess: (r) => { toast.success(`Đã gửi đơn nghỉ ${fmtDays(r.days)} ngày, chờ duyệt`); onOpenChange(false); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xin nghỉ</DialogTitle>
          <DialogDescription>Đơn được gửi tới quản lý trực tiếp rồi HR duyệt.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <SelectField id="leave-type" label="Loại nghỉ" value={typeId} onChange={setTypeId} error={errors.leaveTypeId}
            options={types.map((t) => ({ value: t.id, label: `${t.name}${t.isPaid ? '' : ' (không lương)'}` }))} />
          {type?.usesAnnualBalance && balance && (
            <p className="-mt-2 text-xs text-muted-foreground">Phép năm còn <b>{fmtDays(balance.available)}</b> ngày</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormField id="leave-start" label="Từ ngày" type="date" required value={start}
              onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} error={errors.startDate} />
            <FormField id="leave-end" label="Đến ngày" type="date" required min={start} value={end} onChange={(e) => setEnd(e.target.value)} error={errors.endDate} />
          </div>
          {singleDay && (
            <SelectField id="leave-period" label="Buổi" value={period} onChange={(v) => setPeriod((v ?? 'FullDay') as LeavePeriod)} error={errors.period}
              options={(['FullDay', 'Morning', 'Afternoon'] as const).map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
          )}
          <div className="rounded-lg bg-muted p-3 text-sm" data-testid="leave-preview">
            {preview.data
              ? preview.data.days > 0
                ? <>Số ngày nghỉ: <b>{fmtDays(preview.data.days)}</b> ngày làm việc{preview.data.workingDays.length > 1 && ` (${preview.data.workingDays.map((d) => formatDate(d).slice(0, 5)).join(', ')})`}</>
                : 'Không có ngày làm việc nào trong khoảng này'
              : preview.isFetching ? 'Đang tính…' : preview.error ? errorMessage(preview.error) : '—'}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leave-reason">Lý do</Label>
            <Textarea id="leave-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending || !typeId || preview.data?.days === 0}>{create.isPending ? 'Đang gửi…' : 'Gửi đơn'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
