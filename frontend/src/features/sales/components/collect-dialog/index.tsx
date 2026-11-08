import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { todayVn, useAccounts, useCategories } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney, groupDigits, parseMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useSalesMutation } from '../../hooks/useSales';
import type { ICollectRequest, IInstallment } from '../../types/sales.types';

/** Kế toán (quyền Ghi sổ) ghi nhận tiền khách trả cho một đợt → sinh dòng THU trong sổ thu chi. Thu được nhiều lần đến khi đủ. */
export function CollectDialog({ installment, contractCode, onClose }: { installment: IInstallment | null; contractCode: string; onClose: () => void }) {
  const accounts = (useAccounts(!!installment).data ?? []).filter((a) => a.isActive);
  const categories = (useCategories().data ?? []).filter((c) => c.isActive && c.kind === 'Income');
  const [f, setF] = useState<ICollectRequest>({ amount: 0, date: todayVn(), accountId: '', categoryId: null, invoiceNumber: '' });
  const run = useSalesMutation((a: { id: string; body: ICollectRequest }) => salesApi.collect(a.id, a.body));
  useEffect(() => {
    if (!installment) return;
    run.reset();
    setF({ amount: installment.remaining, date: todayVn(), accountId: '', categoryId: categories.find((c) => c.name.startsWith('Doanh thu'))?.id ?? null, invoiceNumber: '' });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [installment?.id]);
  const errors = fieldErrors(run.error);
  return (
    <Dialog open={!!installment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ghi nhận thu — {contractCode}</DialogTitle>
          <DialogDescription>{installment && `${installment.title}: còn phải thu ${formatMoney(installment.remaining)}`}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          if (installment) run.mutate({ id: installment.id, body: { ...f, invoiceNumber: f.invoiceNumber || null } }, {
            onSuccess: () => { toast.success('Đã ghi nhận thu và ghi sổ'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <FormField id="cl-amount" label="Số tiền thu (đ) *" inputMode="numeric" required value={groupDigits(f.amount)} onChange={(e) => setF({ ...f, amount: parseMoney(e.target.value) })}
            error={errors.amount} hint={f.amount ? formatMoney(f.amount) : undefined} />
          <FormField id="cl-date" label="Ngày nhận tiền *" type="date" required max={todayVn()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={errors.date} />
          <SelectField id="cl-acc" label="Vào quỹ / tài khoản *" value={f.accountId || null} onChange={(v) => setF({ ...f, accountId: v ?? '' })}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))} error={errors.accountId} />
          <SelectField id="cl-cat" label="Danh mục thu" allowEmpty value={f.categoryId ?? null} onChange={(v) => setF({ ...f, categoryId: v })} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={errors.categoryId} />
          <FormField id="cl-inv" label="Số hoá đơn VAT (nếu đã xuất)" maxLength={50} value={f.invoiceNumber ?? ''} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} />
          {errors.businessLineId && <p className="text-xs text-destructive">{errors.businessLineId}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={run.isPending || !f.accountId}>Ghi nhận</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
