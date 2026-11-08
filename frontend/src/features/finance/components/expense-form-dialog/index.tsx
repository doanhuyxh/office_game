import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { financeApi } from '../../api/finance.api';
import { useCategories, useFinanceMutation, useFinanceProjects, useLines } from '../../hooks/useFinance';
import type { IExpenseRequest } from '../../types/finance.types';
import { groupDigits, parseMoney, todayVn } from '../../utils/labels';

const empty = (): IExpenseRequest => ({ amount: 0, reason: '', payee: '', categoryId: null, businessLineId: null, neededBy: null, projectId: null });

/** Gửi đề nghị chi (mọi nhân viên). Duyệt: quản lý trực tiếp → người có quyền Duyệt chi; kế toán chi sau khi duyệt. */
export function ExpenseFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState<IExpenseRequest>(empty);
  const categories = (useCategories().data ?? []).filter((c) => c.isActive && c.kind === 'Expense');
  const lines = (useLines().data ?? []).filter((l) => l.isActive);
  const projects = useFinanceProjects(open).data ?? [];
  const save = useFinanceMutation(financeApi.createExpense);
  useEffect(() => { if (open) { save.reset(); setF(empty()); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IExpenseRequest>(k: K, v: IExpenseRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...f, neededBy: f.neededBy || null }, {
      onSuccess: () => { toast.success('Đã gửi đề nghị chi — chờ duyệt'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đề nghị chi</DialogTitle>
          <DialogDescription>Mọi khoản chi đều cần duyệt: quản lý trực tiếp → Ban giám đốc. Theo dõi ở mục Phê duyệt.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <FormField id="x-amount" label="Số tiền (đ) *" inputMode="numeric" required autoFocus value={groupDigits(f.amount)} onChange={(e) => set('amount', parseMoney(e.target.value))}
            error={errors.amount} hint={f.amount ? formatMoney(f.amount) : undefined} />
          <div className="grid gap-2">
            <Label htmlFor="x-reason">Lý do chi *</Label>
            <Textarea id="x-reason" required maxLength={1000} rows={3} value={f.reason} onChange={(e) => set('reason', e.target.value)} aria-invalid={!!errors.reason} />
            {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
          </div>
          <FormField id="x-payee" label="Người / đơn vị nhận tiền" maxLength={200} value={f.payee ?? ''} onChange={(e) => set('payee', e.target.value)} error={errors.payee} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField id="x-cat" label="Danh mục" allowEmpty value={f.categoryId ?? null} onChange={(v) => set('categoryId', v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={errors.categoryId} />
            <SelectField id="x-line" label="Mảng kinh doanh" allowEmpty value={f.businessLineId ?? null} onChange={(v) => set('businessLineId', v)} options={lines.map((l) => ({ value: l.id, label: l.name }))} error={errors.businessLineId} />
          </div>
          {projects.length > 0 && <SelectField id="x-project" label="Chi cho dự án" allowEmpty value={f.projectId ?? null} onChange={(v) => set('projectId', v)}
            options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} error={errors.projectId} />}
          <FormField id="x-needed" label="Cần chi trước ngày" type="date" min={todayVn()} value={f.neededBy ?? ''} onChange={(e) => set('neededBy', e.target.value)} error={errors.neededBy} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>Gửi đề nghị</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
