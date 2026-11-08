import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { financeApi } from '../../api/finance.api';
import { useAccounts, useFinanceMutation } from '../../hooks/useFinance';
import type { IExpense, IPayExpense } from '../../types/finance.types';
import { todayVn } from '../../utils/labels';

/** Kế toán (quyền Ghi sổ) chi tiền cho đề nghị đã duyệt → sinh một dòng chi trong sổ (bấm hai lần cũng chỉ ghi một). */
export function PayExpenseDialog({ expense, onClose }: { expense: IExpense | null; onClose: () => void }) {
  const accounts = (useAccounts(!!expense).data ?? []).filter((a) => a.isActive);
  const [f, setF] = useState<IPayExpense>({ accountId: '', date: todayVn(), invoiceNumber: '' });
  const pay = useFinanceMutation((a: { id: string; body: IPayExpense }) => financeApi.payExpense(a.id, a.body));
  useEffect(() => { if (expense) { pay.reset(); setF({ accountId: '', date: todayVn(), invoiceNumber: '' }); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [expense?.id]);
  const errors = fieldErrors(pay.error);
  return (
    <Dialog open={!!expense} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Chi tiền {expense?.code}</DialogTitle>
          <DialogDescription>{expense && `${formatMoney(expense.amount)} · ${expense.reason}${expense.payee ? ` · Nhận: ${expense.payee}` : ''}`}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          if (expense) pay.mutate({ id: expense.id, body: { ...f, invoiceNumber: f.invoiceNumber || null } }, {
            onSuccess: () => { toast.success('Đã chi và ghi sổ'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <SelectField id="p-acc" label="Chi từ quỹ *" value={f.accountId || null} onChange={(v) => setF({ ...f, accountId: v ?? '' })}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} — ${formatMoney(a.balance)}` }))} error={errors.accountId} />
          <FormField id="p-date" label="Ngày chi *" type="date" required max={todayVn()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} error={errors.date} />
          <FormField id="p-inv" label="Số hoá đơn (nếu có)" maxLength={50} value={f.invoiceNumber ?? ''} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} error={errors.invoiceNumber} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={pay.isPending || !f.accountId}>Xác nhận đã chi</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
