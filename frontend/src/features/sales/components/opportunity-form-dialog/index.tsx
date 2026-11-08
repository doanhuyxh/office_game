import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { useLines } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney, groupDigits, parseMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useCustomers, useSalesMutation } from '../../hooks/useSales';
import type { IOpportunity, IOpportunityRequest, OpportunityStage } from '../../types/sales.types';
import { STAGE } from '../../utils/labels';

/**
 * Thêm / sửa cơ hội. `opportunity`: undefined = đóng, null = thêm mới. `customerId` cố định khi mở từ trang khách; không có thì chọn khách.
 * Bỏ trống xác suất = mặc định theo giai đoạn (Tiềm năng 10 % … Đàm phán 70 %).
 */
export function OpportunityFormDialog({ opportunity, customerId, onClose }: { opportunity: IOpportunity | null | undefined; customerId?: string; onClose: () => void }) {
  const open = opportunity !== undefined;
  const lines = (useLines().data ?? []).filter((l) => l.isActive);
  const customers = useCustomers('', false, { page: 1, pageSize: 200 }).data?.items ?? [];
  const [f, setF] = useState<IOpportunityRequest>({ customerId: '', title: '', stage: 'Lead', value: 0 });
  const [prob, setProb] = useState('');
  const save = useSalesMutation((b: IOpportunityRequest) => salesApi.saveOpportunity(opportunity?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    const o = opportunity;
    setF(o ? { customerId: o.customerId, title: o.title, stage: o.stage, value: o.value, businessLineId: o.businessLineId, expectedCloseOn: o.expectedCloseOn ?? '', lostReason: o.lostReason ?? '' }
      : { customerId: customerId ?? '', title: '', stage: 'Lead', value: 0, businessLineId: null, expectedCloseOn: '', lostReason: '' });
    setProb(o ? String(o.probability) : '');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, opportunity?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IOpportunityRequest>(k: K, v: IOpportunityRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{opportunity ? 'Sửa cơ hội' : 'Thêm cơ hội'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, probability: prob === '' ? null : Number(prob), expectedCloseOn: f.expectedCloseOn || null, lostReason: f.stage === 'Lost' ? f.lostReason : null }, {
            onSuccess: () => { toast.success('Đã lưu cơ hội'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          {!customerId && !opportunity && <SelectField id="op-cust" label="Khách hàng *" value={f.customerId || null} onChange={(v) => set('customerId', v ?? '')}
            options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} placeholder={customers.length ? 'Chọn khách…' : 'Chưa có khách — thêm ở tab Khách hàng'} />}
          <FormField id="op-title" label="Tên cơ hội *" required autoFocus maxLength={200} placeholder="App đặt lịch, kênh TikTok…" value={f.title} onChange={(e) => set('title', e.target.value)} error={errors.title} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField id="op-stage" label="Giai đoạn" value={f.stage} onChange={(v) => { set('stage', (v ?? 'Lead') as OpportunityStage); if (opportunity?.stage !== v) setProb(''); }}
              options={(Object.keys(STAGE) as OpportunityStage[]).map((s) => ({ value: s, label: STAGE[s].label }))} />
            <FormField id="op-prob" label="Xác suất (%)" type="number" min={0} max={100} placeholder="Theo giai đoạn" value={prob} onChange={(e) => setProb(e.target.value)} error={errors.probability} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="op-value" label="Giá trị dự kiến (đ)" inputMode="numeric" value={groupDigits(f.value)} onChange={(e) => set('value', parseMoney(e.target.value))}
              error={errors.value} hint={f.value ? formatMoney(f.value) : undefined} />
            <FormField id="op-close" label="Dự kiến chốt" type="date" value={f.expectedCloseOn ?? ''} onChange={(e) => set('expectedCloseOn', e.target.value)} />
          </div>
          <SelectField id="op-line" label="Mảng kinh doanh" allowEmpty value={f.businessLineId ?? null} onChange={(v) => set('businessLineId', v)} options={lines.map((l) => ({ value: l.id, label: l.name }))} />
          {f.stage === 'Lost' && <FormField id="op-lost" label="Lý do thua *" required maxLength={500} value={f.lostReason ?? ''} onChange={(e) => set('lostReason', e.target.value)} error={errors.lostReason} />}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending || !f.customerId}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
