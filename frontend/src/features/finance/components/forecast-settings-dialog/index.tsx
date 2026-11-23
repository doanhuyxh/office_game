import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { financeApi } from '../../api/finance.api';
import { useFinanceMutation } from '../../hooks/useFinance';
import type { IForecastSettings } from '../../types/finance.types';

/** Cấu hình dự báo (chỉ Quản trị tài chính): ngày trả lương (1–28) + số ngày tiền cơ hội về sau ngày dự kiến chốt (0–180). Lỗi server hiện theo field. */
export function ForecastSettingsDialog({ open, settings, onClose }: { open: boolean; settings: IForecastSettings | undefined; onClose: () => void }) {
  const [f, setF] = useState({ payrollPayDay: '', pipelineDelayDays: '' });
  const save = useFinanceMutation(financeApi.saveForecastSettings);
  useEffect(() => {
    if (open && settings) { save.reset(); setF({ payrollPayDay: String(settings.payrollPayDay), pipelineDelayDays: String(settings.pipelineDelayDays) }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const errors = fieldErrors(save.error);
  const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ payrollPayDay: num(f.payrollPayDay), pipelineDelayDays: num(f.pipelineDelayDays) }, {
      onSuccess: () => { toast.success('Đã lưu cấu hình dự báo'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="forecast-settings-dialog">
        <DialogHeader>
          <DialogTitle>Cấu hình dự báo</DialogTitle>
          <DialogDescription>Lương tháng M trả vào ngày này của tháng M+1. Tiền cơ hội về sau ngày dự kiến chốt số ngày trễ.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <FormField id="fc-payday" label="Ngày trả lương trong tháng (1–28) *" type="number" inputMode="numeric" min={1} max={28} required
            value={f.payrollPayDay} onChange={(e) => setF({ ...f, payrollPayDay: e.target.value })} error={errors.payrollPayDay} />
          <FormField id="fc-delay" label="Số ngày tiền cơ hội về sau ngày chốt (0–180) *" type="number" inputMode="numeric" min={0} max={180} required
            value={f.pipelineDelayDays} onChange={(e) => setF({ ...f, pipelineDelayDays: e.target.value })} error={errors.pipelineDelayDays} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" loading={save.isPending} loadingText="Đang lưu…" data-testid="forecast-settings-save">Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
