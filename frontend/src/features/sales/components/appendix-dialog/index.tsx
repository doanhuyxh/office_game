import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { todayVn } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney, groupDigits, parseMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useSalesMutation } from '../../hooks/useSales';
import type { IAppendixRequest, IContractDetail } from '../../types/sales.types';

const vatOf = (before: number, rate: number) => before + Math.round((before * rate) / 100);

/**
 * Lập phụ lục: tăng / giảm giá trị trước thuế (VAT theo thuế suất hợp đồng), đợt thu mới khi tăng, gắn yêu cầu thay đổi (CR) đã được khách đồng ý.
 * Giảm giá trị: không kèm đợt mới; phải huỷ bớt đợt trước nếu đã lên lịch vượt giá trị mới (back-end kiểm tra).
 */
export function AppendixDialog({ d, open, onClose }: { d: IContractDetail; open: boolean; onClose: () => void }) {
  const k = d.contract;
  const [f, setF] = useState<IAppendixRequest>({ code: '', title: '', signedOn: todayVn(), valueBeforeTaxDelta: 0, installments: [] });
  const [decrease, setDecrease] = useState(false);
  const save = useSalesMutation((b: IAppendixRequest) => salesApi.createAppendix(k.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset(); setDecrease(false);
    const cr = d.pendingChangeRequests[0];
    setF({ code: `PL${String(d.appendices.length + 1).padStart(2, '0')}`, title: cr ? `Thay đổi ${cr.code}: ${cr.title}` : '', signedOn: todayVn(), valueBeforeTaxDelta: 0,
      installments: [], changeRequestId: cr?.id ?? null, note: '' });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);
  const errors = fieldErrors(save.error);
  const delta = decrease ? -f.valueBeforeTaxDelta : f.valueBeforeTaxDelta;
  const totalDelta = vatOf(delta, d.vatRate);
  const items = decrease ? [] : f.installments;
  const sum = items.reduce((t, i) => t + i.amount, 0);
  const setItem = (idx: number, patch: Partial<IAppendixRequest['installments'][number]>) =>
    setF({ ...f, installments: f.installments.map((x, i) => (i === idx ? { ...x, ...patch } : x)) });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Lập phụ lục — HĐ {k.code}</DialogTitle>
          <DialogDescription>Giá trị hiện tại {formatMoney(k.totalValue)} (gồm VAT {d.vatRate}%). Phụ lục cộng / trừ thẳng vào giá trị hợp đồng và lãi / lỗ dự án.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, valueBeforeTaxDelta: delta, installments: items, note: f.note || null }, {
            onSuccess: () => { toast.success('Đã lập phụ lục'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <FormField id="ap-code" label="Số phụ lục *" required maxLength={50} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} error={errors.code} />
            <FormField id="ap-title" label="Nội dung *" required maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errors.title} />
          </div>
          {d.pendingChangeRequests.length > 0 && (
            <SelectField id="ap-cr" label="Từ yêu cầu thay đổi (khách đã đồng ý)" allowEmpty emptyLabel="— Không gắn —" value={f.changeRequestId ?? null}
              onChange={(v) => setF({ ...f, changeRequestId: v })} error={errors.changeRequestId}
              options={d.pendingChangeRequests.map((c) => ({ value: c.id, label: `${c.code} · ${c.title}${c.estimateManDays ? ` (${c.estimateManDays} ngày công)` : ''}` }))} />
          )}
          <div className="grid grid-cols-[9rem_1fr_9.5rem] items-start gap-3">
            <SelectField id="ap-kind" label="Loại" value={decrease ? 'down' : 'up'} onChange={(v) => setDecrease(v === 'down')}
              options={[{ value: 'up', label: 'Tăng giá trị' }, { value: 'down', label: 'Giảm giá trị' }]} />
            <FormField id="ap-amount" label="Giá trị trước thuế (đ) *" inputMode="numeric" required value={groupDigits(f.valueBeforeTaxDelta)}
              onChange={(e) => setF({ ...f, valueBeforeTaxDelta: parseMoney(e.target.value) })} error={errors.valueBeforeTaxDelta}
              hint={f.valueBeforeTaxDelta ? `${decrease ? '−' : '+'}${formatMoney(Math.abs(totalDelta))} sau thuế → HĐ còn ${formatMoney(k.totalValue + totalDelta)}` : undefined} />
            <FormField id="ap-signed" label="Ngày ký *" type="date" required max={todayVn()} value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} error={errors.signedOn} />
          </div>
          {!decrease && (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between text-sm font-medium">Đợt thu mới <span className="text-xs font-normal text-muted-foreground">{formatMoney(sum)} / {formatMoney(Math.max(0, totalDelta))}</span></div>
              {f.installments.map((x, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_9.5rem_9rem_auto] gap-2">
                  <Input aria-label="Tên đợt" required value={x.title} onChange={(e) => setItem(idx, { title: e.target.value })} />
                  <Input aria-label="Hạn" type="date" required value={x.dueOn} onChange={(e) => setItem(idx, { dueOn: e.target.value })} />
                  <Input aria-label="Số tiền" inputMode="numeric" value={groupDigits(x.amount)} onChange={(e) => setItem(idx, { amount: parseMoney(e.target.value) })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Bỏ đợt" onClick={() => setF({ ...f, installments: f.installments.filter((_, i) => i !== idx) })}><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={totalDelta - sum <= 0}
                onClick={() => setF({ ...f, installments: [...f.installments, { title: `Phụ lục ${f.code}${f.installments.length ? ` – đợt ${f.installments.length + 1}` : ''}`, dueOn: todayVn(), amount: Math.max(0, totalDelta - sum) }] })}>
                <Plus /> Thêm đợt</Button>
              {errors.installments && <p className="text-xs text-destructive">{errors.installments}</p>}
            </div>
          )}
          <FormField id="ap-note" label="Ghi chú" maxLength={2000} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending || !f.valueBeforeTaxDelta}>Lập phụ lục</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
