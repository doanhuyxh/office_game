import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { todayVn, useLines } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney, groupDigits, parseMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useCustomers, useSalesMutation } from '../../hooks/useSales';
import type { BillingKind, IContractRequest, IInstallmentInput, IOpportunity, IQuoteDetail } from '../../types/sales.types';
import { BILLING, totalWithVat, VAT_RATES } from '../../utils/labels';

/** Lịch thu hằng tháng — khớp SalesRules.MonthlySchedule (tháng ngắn → ngày cuối tháng). */
function monthly(first: string, count: number, amount: number): IInstallmentInput[] {
  const [y, m, d] = first.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const year = y + Math.floor((m - 1 + i) / 12), month = ((m - 1 + i) % 12) + 1;
    const day = Math.min(d, new Date(year, month, 0).getDate());
    return { title: `Tháng ${String(month).padStart(2, '0')}/${year}`, dueOn: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, amount };
  });
}

/** Tạo hợp đồng bán + lịch thu. Theo mốc / một lần: tổng các đợt phải bằng giá trị sau thuế; hằng tháng: không vượt. */
export function ContractFormDialog({ open, customerId, opportunities = [], fromQuote, onClose, onCreated }: {
  open: boolean; customerId?: string; opportunities?: IOpportunity[]; fromQuote?: IQuoteDetail; onClose: () => void; onCreated?: (id: string) => void;
}) {
  const lines = (useLines().data ?? []).filter((l) => l.isActive);
  const customers = useCustomers('', false, { page: 1, pageSize: 200 }).data?.items ?? [];
  const blank = (): IContractRequest => ({ code: '', customerId: customerId ?? '', title: '', valueBeforeTax: 0, vatRate: 10, signedOn: todayVn(), billing: 'Milestone',
    installments: [{ title: 'Đợt 1', dueOn: todayVn(), amount: 0 }], endOn: '', opportunityId: null, businessLineId: null, note: '' });
  const [f, setF] = useState<IContractRequest>(blank);
  const [months, setMonths] = useState({ first: todayVn(), count: 12, amount: 0 });
  const save = useSalesMutation(salesApi.createContract);
  useEffect(() => {
    if (!open) return;
    save.reset();
    const q = fromQuote?.quote;
    // Lập từ báo giá: điền giá trị trước thuế / VAT / tên / cơ hội; một đợt thu trọn giá trị (sửa lại theo mốc).
    setF(q ? { ...blank(), customerId: q.customerId, title: q.title, valueBeforeTax: q.beforeTax, vatRate: q.vatRate, opportunityId: q.opportunityId,
      businessLineId: fromQuote?.businessLineId ?? null, quoteId: q.id, note: fromQuote?.terms ?? '', installments: [{ title: 'Đợt 1', dueOn: todayVn(), amount: q.total }] } : blank());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IContractRequest>(k: K, v: IContractRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const total = totalWithVat(f.valueBeforeTax, f.vatRate);
  const sum = f.installments.reduce((t, i) => t + i.amount, 0);
  const setItem = (i: number, patch: Partial<IInstallmentInput>) => set('installments', f.installments.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const openOpps = opportunities.filter((o) => o.stage !== 'Won' && o.stage !== 'Lost');
  const sumOk = f.billing === 'Monthly' ? sum <= total : sum === total;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo hợp đồng bán</DialogTitle>
          <DialogDescription>Lịch thu tạo công nợ phải thu; kế toán ghi nhận tiền khách trả vào sổ thu chi.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, endOn: f.endOn || null, note: f.note || null }, {
            onSuccess: (id) => { toast.success('Đã tạo hợp đồng'); onClose(); onCreated?.(id); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          {!customerId && <SelectField id="k-cust" label="Khách hàng *" value={f.customerId || null} onChange={(v) => set('customerId', v ?? '')}
            options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
            <FormField id="k-code" label="Số hợp đồng *" required maxLength={50} placeholder="HĐ-2026-001" value={f.code} onChange={(e) => set('code', e.target.value)} error={errors.code} />
            <FormField id="k-title" label="Tên hợp đồng *" required maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
          </div>
          {openOpps.length > 0 && <SelectField id="k-opp" label="Từ cơ hội (ký xong → Thắng)" allowEmpty value={f.opportunityId ?? null}
            onChange={(v) => { const o = openOpps.find((x) => x.id === v); setF((x) => ({ ...x, opportunityId: v, businessLineId: o?.businessLineId ?? x.businessLineId, title: x.title || o?.title || '' })); }}
            options={openOpps.map((o) => ({ value: o.id, label: `${o.title} — ${formatMoney(o.value)}` }))} />}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2"><FormField id="k-value" label="Giá trị trước thuế (đ) *" inputMode="numeric" required value={groupDigits(f.valueBeforeTax)}
              disabled={!!f.quoteId} onChange={(e) => set('valueBeforeTax', parseMoney(e.target.value))} error={errors.valueBeforeTax}
              hint={f.quoteId ? `Theo báo giá — sau thuế: ${formatMoney(total)}` : `Sau thuế: ${formatMoney(total)}`} /></div>
            <SelectField id="k-vat" label="VAT" disabled={!!f.quoteId} value={String(f.vatRate)} onChange={(v) => set('vatRate', Number(v ?? 10))} options={VAT_RATES.map((r) => ({ value: String(r), label: `${r} %` }))} error={errors.vatRate} />
            <SelectField id="k-billing" label="Kiểu thu" value={f.billing} onChange={(v) => set('billing', (v ?? 'Milestone') as BillingKind)}
              options={(Object.keys(BILLING) as BillingKind[]).map((b) => ({ value: b, label: BILLING[b] }))} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <FormField id="k-signed" label="Ngày ký *" type="date" required max={todayVn()} value={f.signedOn} onChange={(e) => set('signedOn', e.target.value)} error={errors.signedOn} />
            <FormField id="k-end" label="Ngày kết thúc" type="date" value={f.endOn ?? ''} onChange={(e) => set('endOn', e.target.value)} error={errors.endOn} />
            <SelectField id="k-line" label="Mảng" allowEmpty value={f.businessLineId ?? null} onChange={(v) => set('businessLineId', v)} options={lines.map((l) => ({ value: l.id, label: l.name }))} />
          </div>
          <div className="grid gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">Lịch thu ({f.installments.length} đợt)</span>
              <span className={sumOk ? 'text-muted-foreground' : 'text-rose-600'}>Tổng {formatMoney(sum)} / {formatMoney(total)}</span>
            </div>
            {f.billing === 'Monthly' && (
              <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
                <div className="w-40"><FormField id="m-first" label="Tháng đầu, hạn ngày" type="date" value={months.first} onChange={(e) => setMonths({ ...months, first: e.target.value })} /></div>
                <div className="w-24"><FormField id="m-count" label="Số tháng" type="number" min={1} max={120} value={months.count} onChange={(e) => setMonths({ ...months, count: Number(e.target.value) || 1 })} /></div>
                <div className="w-40"><FormField id="m-amount" label="Mỗi tháng (đ)" inputMode="numeric" value={groupDigits(months.amount)} onChange={(e) => setMonths({ ...months, amount: parseMoney(e.target.value) })} /></div>
                <Button type="button" variant="outline" size="sm" onClick={() => set('installments', monthly(months.first, Math.min(120, months.count), months.amount || Math.floor(total / months.count)))}>Tạo lịch</Button>
              </div>
            )}
            {f.installments.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_9.5rem_9rem_2rem] items-center gap-2">
                <Input aria-label={`Tên đợt ${i + 1}`} value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} />
                <Input aria-label={`Hạn đợt ${i + 1}`} type="date" value={it.dueOn} onChange={(e) => setItem(i, { dueOn: e.target.value })} />
                <Input aria-label={`Số tiền đợt ${i + 1}`} inputMode="numeric" value={groupDigits(it.amount)} onChange={(e) => setItem(i, { amount: parseMoney(e.target.value) })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Xoá đợt" disabled={f.installments.length === 1} onClick={() => set('installments', f.installments.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => set('installments', [...f.installments, { title: `Đợt ${f.installments.length + 1}`, dueOn: f.installments.at(-1)?.dueOn ?? todayVn(), amount: Math.max(0, total - sum) }])}><Plus /> Thêm đợt</Button>
              {f.billing !== 'Monthly' && sum !== total && f.installments.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setItem(f.installments.length - 1, { amount: f.installments.at(-1)!.amount + total - sum })}>Dồn phần lệch vào đợt cuối</Button>
              )}
            </div>
            {errors.installments && <p className="text-xs text-destructive">{errors.installments}</p>}
          </div>
          <FormField id="k-note" label="Ghi chú" maxLength={2000} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending || !f.customerId}>Tạo hợp đồng</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
