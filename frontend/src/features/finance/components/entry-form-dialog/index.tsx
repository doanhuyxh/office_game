import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { financeApi } from '../../api/finance.api';
import { useAccounts, useCategories, useFinanceMutation, useFinanceProjects, useLines } from '../../hooks/useFinance';
import type { IEntryRequest, TxKind } from '../../types/finance.types';
import { groupDigits, parseMoney, todayVn, TX_KIND_LABEL } from '../../utils/labels';

const empty = (): IEntryRequest => ({ kind: 'Expense', date: todayVn(), amount: 0, accountId: '', toAccountId: null, categoryId: null, businessLineId: null, projectId: null, counterparty: '', description: '', invoiceNumber: '' });

/** Ghi một dòng sổ (người có quyền Ghi sổ). Chuyển quỹ: không có danh mục; trừ quỹ gửi, cộng quỹ nhận. */
export function EntryFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [f, setF] = useState<IEntryRequest>(empty);
  const accounts = (useAccounts().data ?? []).filter((a) => a.isActive);
  const categories = (useCategories().data ?? []).filter((c) => c.isActive && c.kind === f.kind);
  const lines = (useLines().data ?? []).filter((l) => l.isActive);
  const projects = useFinanceProjects(open).data ?? [];
  const save = useFinanceMutation(financeApi.createEntry);
  useEffect(() => { if (open) { save.reset(); setF(empty()); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IEntryRequest>(k: K, v: IEntryRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const transfer = f.kind === 'Transfer';
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...f, toAccountId: transfer ? f.toAccountId : null, categoryId: transfer ? null : f.categoryId, projectId: transfer ? null : f.projectId }, {
      onSuccess: () => { toast.success('Đã ghi sổ'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  const accOpts = accounts.map((a) => ({ value: a.id, label: `${a.name} — ${formatMoney(a.balance)}` }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ghi giao dịch</DialogTitle>
          <DialogDescription>Không xoá được — ghi nhầm thì huỷ kèm lý do rồi ghi lại.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <SelectField id="e-kind" label="Loại *" value={f.kind} onChange={(v) => setF((x) => ({ ...x, kind: (v ?? 'Expense') as TxKind, categoryId: null }))}
              options={(['Income', 'Expense', 'Transfer'] as TxKind[]).map((k) => ({ value: k, label: TX_KIND_LABEL[k] }))} />
            <FormField id="e-date" label="Ngày *" type="date" required max={todayVn()} value={f.date} onChange={(e) => set('date', e.target.value)} error={errors.date} />
          </div>
          <FormField id="e-amount" label="Số tiền (đ) *" inputMode="numeric" required value={groupDigits(f.amount)} onChange={(e) => set('amount', parseMoney(e.target.value))}
            error={errors.amount} hint={f.amount ? formatMoney(f.amount) : undefined} />
          <SelectField id="e-account" label={transfer ? 'Từ quỹ *' : 'Quỹ / tài khoản *'} value={f.accountId || null} onChange={(v) => set('accountId', v ?? '')} options={accOpts}
            error={errors.accountId} placeholder={accounts.length ? 'Chọn quỹ…' : 'Chưa có quỹ — tạo ở tab Cấu hình'} />
          {transfer
            ? <SelectField id="e-to" label="Đến quỹ *" value={f.toAccountId ?? null} onChange={(v) => set('toAccountId', v)} options={accOpts.filter((o) => o.value !== f.accountId)} error={errors.toAccountId} />
            : <SelectField id="e-cat" label="Danh mục" allowEmpty value={f.categoryId ?? null} onChange={(v) => set('categoryId', v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} error={errors.categoryId} />}
          <SelectField id="e-line" label="Mảng kinh doanh" allowEmpty value={f.businessLineId ?? null} onChange={(v) => set('businessLineId', v)} options={lines.map((l) => ({ value: l.id, label: l.name }))} error={errors.businessLineId} />
          {!transfer && <SelectField id="e-project" label="Dự án (tính vào lãi / lỗ dự án)" allowEmpty value={f.projectId ?? null} onChange={(v) => set('projectId', v)}
            options={projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} error={errors.projectId} />}
          {!transfer && <FormField id="e-cp" label={f.kind === 'Income' ? 'Người / đơn vị trả' : 'Người / đơn vị nhận'} maxLength={200} value={f.counterparty ?? ''} onChange={(e) => set('counterparty', e.target.value)} error={errors.counterparty} />}
          <FormField id="e-desc" label="Diễn giải" maxLength={1000} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} error={errors.description} />
          {!transfer && <FormField id="e-inv" label="Số hoá đơn (nếu có)" maxLength={50} value={f.invoiceNumber ?? ''} onChange={(e) => set('invoiceNumber', e.target.value)} error={errors.invoiceNumber} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>Ghi sổ</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
