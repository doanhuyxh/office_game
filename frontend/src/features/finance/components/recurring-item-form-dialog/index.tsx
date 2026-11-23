import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { financeApi } from '../../api/finance.api';
import { useFinanceMutation, useLines } from '../../hooks/useFinance';
import type { CategoryKind, IRecurringItem, IRecurringItemRequest } from '../../types/finance.types';
import { groupDigits, parseMoney } from '../../utils/labels';

const EMPTY: IRecurringItemRequest = { name: '', kind: 'Expense', amount: 0, dayOfMonth: 5, businessLineId: null, isActive: true, note: null };

/** Thêm / sửa một khoản định kỳ dự kiến (`item` null = thêm, undefined = đóng). Không xoá — bỏ chọn "Đang dùng" để ngừng. */
export function RecurringItemFormDialog({ item, onClose }: { item: IRecurringItem | null | undefined; onClose: () => void }) {
  const lines = (useLines().data ?? []).filter((l) => l.isActive || l.id === item?.businessLineId);
  const [f, setF] = useState<IRecurringItemRequest>(EMPTY);
  const [day, setDay] = useState('5');
  const save = useFinanceMutation((b: IRecurringItemRequest) => financeApi.saveRecurring(item?.id, b));
  useEffect(() => {
    if (item === undefined) return;
    save.reset();
    const init = item ? { name: item.name, kind: item.kind, amount: item.amount, dayOfMonth: item.dayOfMonth, businessLineId: item.businessLineId, isActive: item.isActive, note: item.note } : EMPTY;
    setF(init);
    setDay(String(init.dayOfMonth));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IRecurringItemRequest>(k: K, v: IRecurringItemRequest[K]) => setF((p) => ({ ...p, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...f, name: f.name.trim(), dayOfMonth: day.trim() === '' ? 0 : Number(day), note: f.note?.trim() || null }, {
      onSuccess: () => { toast.success('Đã lưu khoản định kỳ'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={item !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="recurring-item-dialog">
        <DialogHeader>
          <DialogTitle>{item ? `Sửa khoản ${item.name}` : 'Thêm khoản định kỳ dự kiến'}</DialogTitle>
          <DialogDescription>Lặp hằng tháng trong dự báo. Chỉ là số dự kiến — không sinh dòng sổ, không sinh đề nghị chi.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <FormField id="ri-name" label="Tên *" required maxLength={200} value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField id="ri-kind" label="Loại" value={f.kind} onChange={(v) => set('kind', (v ?? 'Expense') as CategoryKind)} error={errors.kind}
              options={[{ value: 'Income', label: 'Thu' }, { value: 'Expense', label: 'Chi' }]} />
            <FormField id="ri-day" label="Ngày trong tháng (1–28) *" type="number" inputMode="numeric" min={1} max={28} required value={day} onChange={(e) => setDay(e.target.value)} error={errors.dayOfMonth} />
          </div>
          <FormField id="ri-amount" label="Số tiền mỗi tháng (đ) *" inputMode="numeric" required value={groupDigits(f.amount)} onChange={(e) => set('amount', parseMoney(e.target.value))}
            error={errors.amount} hint={f.amount ? formatMoney(f.amount) : undefined} />
          <SelectField id="ri-line" label="Mảng kinh doanh" allowEmpty value={f.businessLineId} onChange={(v) => set('businessLineId', v)} error={errors.businessLineId}
            options={lines.map((l) => ({ value: l.id, label: l.name }))} />
          <div className="grid gap-2">
            <Label htmlFor="ri-note">Ghi chú</Label>
            <Textarea id="ri-note" maxLength={1000} rows={2} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} aria-invalid={!!errors.note} />
            {errors.note && <p className="text-xs text-destructive">{errors.note}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(c) => set('isActive', c === true)} /> Đang dùng (bỏ chọn = ngừng, không tính vào dự báo)</label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" loading={save.isPending} loadingText="Đang lưu…" data-testid="recurring-item-save">Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
