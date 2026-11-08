import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { todayVn } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney, groupDigits, parseMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useCustomers, useSalesMutation, useSalesSettings } from '../../hooks/useSales';
import type { IQuoteDetail, IQuoteRequest } from '../../types/sales.types';
import { quoteTotals, VAT_RATES } from '../../utils/labels';

const plusDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/** Tạo / sửa báo giá nháp: hạng mục (SL × đơn giá), chiết khấu %, VAT. Chiết khấu vượt ngưỡng → khi chốt phải qua duyệt. */
export function QuoteFormDialog({ open, quote, customerId, onClose, onCreated }: {
  open: boolean; quote?: IQuoteDetail | null; customerId?: string; onClose: () => void; onCreated?: (id: string) => void;
}) {
  const customers = useCustomers('', false, { page: 1, pageSize: 200 }).data?.items ?? [];
  const limit = useSalesSettings().data?.quoteDiscountLimitPercent ?? 15;
  const blank = (): IQuoteRequest => ({ customerId: customerId ?? '', title: '', issuedOn: todayVn(), validUntil: plusDays(todayVn(), 30), vatRate: 10, discountPercent: 0,
    lines: [{ description: '', unit: '', quantity: 1, unitPrice: 0 }], terms: '', note: '' });
  const [f, setF] = useState<IQuoteRequest>(blank);
  const save = useSalesMutation((b: IQuoteRequest) => salesApi.saveQuote(quote?.quote.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    const q = quote;
    setF(q ? { customerId: q.quote.customerId, title: q.quote.title, issuedOn: q.quote.issuedOn, validUntil: q.quote.validUntil, vatRate: q.quote.vatRate,
      discountPercent: q.quote.discountPercent, opportunityId: q.quote.opportunityId, businessLineId: q.businessLineId, terms: q.terms ?? '', note: q.note ?? '',
      lines: q.lines.map((l) => ({ description: l.description, unit: l.unit ?? '', quantity: l.quantity, unitPrice: l.unitPrice })) } : blank());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, quote?.quote.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IQuoteRequest>(k: K, v: IQuoteRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i: number, patch: Partial<IQuoteRequest['lines'][number]>) => set('lines', f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const t = quoteTotals(f.lines, f.discountPercent || 0, f.vatRate);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{quote ? `Sửa báo giá ${quote.quote.code}` : 'Báo giá mới'}</DialogTitle>
          <DialogDescription>Lưu là nháp; bấm "Chốt" ở chi tiết báo giá để gửi khách (chiết khấu trên {limit}% cần duyệt).</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, terms: f.terms || null, note: f.note || null, lines: f.lines.map((l) => ({ ...l, unit: l.unit || null })) }, {
            onSuccess: (id) => { toast.success('Đã lưu báo giá'); onClose(); if (!quote && typeof id === 'string') onCreated?.(id); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          {!quote && !customerId && <SearchSelectField id="q-cust" label="Khách hàng *" value={f.customerId || null} onChange={(v) => set('customerId', v ?? '')}
            options={customers.map((c) => ({ value: c.id, label: c.name }))} />}
          <FormField id="q-title" label="Tên báo giá *" required maxLength={300} placeholder="Thiết kế app đặt lịch" value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FormField id="q-issued" label="Ngày báo giá" type="date" value={f.issuedOn ?? ''} onChange={(e) => set('issuedOn', e.target.value)} />
            <FormField id="q-valid" label="Hiệu lực đến *" type="date" required value={f.validUntil} onChange={(e) => set('validUntil', e.target.value)} error={errors.validUntil} />
            <SelectField id="q-vat" label="VAT" value={String(f.vatRate)} onChange={(v) => set('vatRate', Number(v ?? 10))} options={VAT_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
            <FormField id="q-disc" label="Chiết khấu (%)" type="number" min={0} max={100} step="0.01" value={f.discountPercent || ''}
              onChange={(e) => set('discountPercent', e.target.value === '' ? 0 : Number(e.target.value))} error={errors.discountPercent}
              hint={f.discountPercent > limit ? `Vượt ngưỡng ${limit}% — cần duyệt` : undefined} />
          </div>
          <div className="grid gap-2 rounded-lg border p-3">
            <div className="grid grid-cols-[1fr_6rem_5.5rem_8.5rem_8rem_auto] gap-2 text-xs font-medium text-muted-foreground"><span>Hạng mục</span><span>ĐVT</span><span>SL</span><span>Đơn giá</span><span className="text-right">Thành tiền</span><span /></div>
            {f.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_5.5rem_8.5rem_8rem_auto] items-center gap-2" data-testid="quote-line">
                <Input aria-label="Hạng mục" required maxLength={500} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                <Input aria-label="Đơn vị" maxLength={30} value={l.unit ?? ''} onChange={(e) => setLine(i, { unit: e.target.value })} />
                <Input aria-label="Số lượng" type="number" min={0.01} step="0.01" value={l.quantity || ''} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
                <Input aria-label="Đơn giá" inputMode="numeric" value={groupDigits(l.unitPrice)} onChange={(e) => setLine(i, { unitPrice: parseMoney(e.target.value) })} />
                <span className="text-right text-sm tabular-nums">{formatMoney(Math.round(l.quantity * l.unitPrice))}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Bỏ hạng mục" disabled={f.lines.length === 1} onClick={() => set('lines', f.lines.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => set('lines', [...f.lines, { description: '', unit: '', quantity: 1, unitPrice: 0 }])}><Plus /> Thêm hạng mục</Button>
            {errors.lines && <p className="text-xs text-destructive">{errors.lines}</p>}
            <div className="grid justify-end gap-0.5 text-right text-sm tabular-nums">
              <span>Cộng: {formatMoney(t.subtotal)}</span>
              {t.discount > 0 && <span>Chiết khấu {f.discountPercent}%: −{formatMoney(t.discount)}</span>}
              <span>Trước thuế: {formatMoney(t.beforeTax)} · VAT {f.vatRate}%: {formatMoney(t.vat)}</span>
              <span className="font-semibold">Tổng cộng: {formatMoney(t.total)}</span>
            </div>
          </div>
          <div className="grid gap-2"><Label htmlFor="q-terms">Điều khoản (thanh toán, tiến độ, bảo hành…)</Label>
            <Textarea id="q-terms" rows={3} maxLength={4000} value={f.terms ?? ''} onChange={(e) => set('terms', e.target.value)} /></div>
          <FormField id="q-note" label="Ghi chú" maxLength={2000} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending || !f.customerId}>Lưu nháp</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
