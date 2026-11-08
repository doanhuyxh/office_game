import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { financeApi } from '../../api/finance.api';
import { useAccounts, useCategories, useFinanceMutation, useFinancePerms, useLines, useLock } from '../../hooks/useFinance';
import type { AccountKind, CategoryKind, IAccount, IAccountRequest, ICategory, ICategoryRequest, ILine, ILineRequest } from '../../types/finance.types';
import { ACCOUNT_KIND_LABEL, fmtDate, groupDigits, parseMoney, todayVn } from '../../utils/labels';

const active = (on: boolean) => <StatusBadge tone={on ? 'success' : 'muted'}>{on ? 'Đang dùng' : 'Ngừng'}</StatusBadge>;
const onErr = (err: unknown) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err));

function Section({ title, hint, onAdd, children }: { title: string; hint?: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div><div className="text-sm font-medium">{title}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div>
        {onAdd && <Button size="sm" variant="outline" onClick={onAdd}><Plus /> Thêm</Button>}
      </div>
      {children}
    </div>
  );
}

/** Cấu hình sổ: quỹ, mảng kinh doanh, danh mục, khoá sổ. Sửa: chỉ quyền "Quản trị tài chính"; người chỉ có quyền Xem thấy bảng (chỉ đọc). */
export function SettingsTab() {
  const { admin } = useFinancePerms();
  const accounts = useAccounts().data ?? [];
  const lines = useLines().data ?? [];
  const categories = useCategories().data ?? [];
  const [acc, setAcc] = useState<IAccount | null | undefined>(undefined);
  const [line, setLine] = useState<ILine | null | undefined>(undefined);
  const [cat, setCat] = useState<ICategory | null | undefined>(undefined);
  const edit = (fn: () => void) => (admin ? <Button variant="ghost" size="icon" aria-label="Sửa" onClick={fn}><Pencil /></Button> : null);
  return (
    <div className="grid grid-cols-1 gap-4">
      {!admin && <p className="text-sm text-muted-foreground">Chỉ người có quyền <b>Quản trị tài chính</b> mới sửa được cấu hình.</p>}
      <LockCard canEdit={admin} />
      <Section title="Quỹ / tài khoản" hint="Số dư đầu kỳ chỉ sửa được khi quỹ chưa có giao dịch. Chỉ lưu 4 số cuối tài khoản ngân hàng." onAdd={admin ? () => setAcc(null) : undefined}>
        <Table>
          <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Loại</TableHead><TableHead className="text-right">Đầu kỳ</TableHead><TableHead>Ngày đầu kỳ</TableHead><TableHead className="text-right">Số dư</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {accounts.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Chưa có quỹ</TableCell></TableRow>}
            {accounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}{a.last4 && <span className="text-muted-foreground"> · …{a.last4}</span>}</TableCell>
                <TableCell>{ACCOUNT_KIND_LABEL[a.kind]}{a.bankName && ` · ${a.bankName}`}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(a.openingBalance)}</TableCell>
                <TableCell>{fmtDate(a.openingDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(a.balance)}</TableCell>
                <TableCell>{active(a.isActive)}</TableCell>
                <TableCell>{edit(() => setAcc(a))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section title="Mảng kinh doanh" hint="Gắn vào giao dịch để xem thu / chi theo mảng." onAdd={admin ? () => setLine(null) : undefined}>
          <Table>
            <TableHeader><TableRow><TableHead>Mã</TableHead><TableHead>Tên</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
            <TableBody>{lines.map((l) => <TableRow key={l.id}><TableCell className="font-medium">{l.code}</TableCell><TableCell>{l.name}</TableCell><TableCell>{active(l.isActive)}</TableCell><TableCell>{edit(() => setLine(l))}</TableCell></TableRow>)}</TableBody>
          </Table>
        </Section>
        <Section title="Danh mục thu / chi" onAdd={admin ? () => setCat(null) : undefined}>
          <Table>
            <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Loại</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
            <TableBody>{categories.map((c) => <TableRow key={c.id}><TableCell className="font-medium">{c.name}</TableCell><TableCell>{c.kind === 'Income' ? 'Thu' : 'Chi'}</TableCell><TableCell>{active(c.isActive)}</TableCell><TableCell>{edit(() => setCat(c))}</TableCell></TableRow>)}</TableBody>
          </Table>
        </Section>
      </div>
      <AccountDialog account={acc} onClose={() => setAcc(undefined)} />
      <LineDialog line={line} onClose={() => setLine(undefined)} />
      <CategoryDialog category={cat} onClose={() => setCat(undefined)} />
    </div>
  );
}

function LockCard({ canEdit }: { canEdit: boolean }) {
  const lock = useLock(true).data;
  const [date, setDate] = useState('');
  const save = useFinanceMutation(financeApi.setLock);
  useEffect(() => setDate(lock?.lockedThrough ?? ''), [lock?.lockedThrough]);
  const errors = fieldErrors(save.error);
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
      <div className="grow">
        <div className="flex items-center gap-2 text-sm font-medium"><Lock className="size-4" /> Khoá sổ</div>
        <div className="text-xs text-muted-foreground">
          {lock?.lockedThrough ? `Đang khoá đến hết ${fmtDate(lock.lockedThrough)} — không ghi / huỷ giao dịch trong kỳ này.` : 'Chưa khoá. Khoá sau khi chốt số liệu tháng để số đã báo cáo không bị sửa.'}
        </div>
      </div>
      {canEdit && <>
        <div className="w-44"><FormField id="lock-date" label="Khoá đến hết ngày" type="date" max={todayVn()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.lockedThrough} /></div>
        <Button disabled={save.isPending || !date || date === lock?.lockedThrough} onClick={() => save.mutate(date, { onSuccess: () => toast.success('Đã khoá sổ'), onError: onErr })}>Lưu</Button>
        {lock?.lockedThrough && <Button variant="outline" disabled={save.isPending} onClick={() => confirm('Mở khoá sổ? Giao dịch các kỳ trước sẽ sửa / huỷ được.') && save.mutate(null, { onSuccess: () => toast.success('Đã mở khoá sổ'), onError: onErr })}>Mở khoá</Button>}
      </>}
    </div>
  );
}

function AccountDialog({ account, onClose }: { account: IAccount | null | undefined; onClose: () => void }) {
  const init = (): IAccountRequest => account
    ? { name: account.name, kind: account.kind, bankName: account.bankName, last4: account.last4, openingBalance: account.openingBalance, openingDate: account.openingDate, isActive: account.isActive, sortOrder: account.sortOrder }
    : { name: '', kind: 'Bank', bankName: '', last4: '', openingBalance: 0, openingDate: todayVn(), isActive: true, sortOrder: 0 };
  const [f, setF] = useState<IAccountRequest>(init);
  const save = useFinanceMutation((b: IAccountRequest) => financeApi.saveAccount(account?.id, b));
  useEffect(() => { if (account !== undefined) { save.reset(); setF(init()); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [account]);
  const errors = fieldErrors(save.error);
  const bank = f.kind === 'Bank';
  return (
    <Dialog open={account !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{account ? `Sửa quỹ ${account.name}` : 'Thêm quỹ / tài khoản'}</DialogTitle><DialogDescription>Số dư đầu kỳ = số tiền thực có vào ngày đầu kỳ.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...f, bankName: bank ? f.bankName || null : null, last4: bank ? f.last4 || null : null }, { onSuccess: () => { toast.success('Đã lưu'); onClose(); }, onError: onErr }); }}>
          <FormField id="a-name" label="Tên *" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} />
          <SelectField id="a-kind" label="Loại" value={f.kind} onChange={(v) => setF({ ...f, kind: (v ?? 'Bank') as AccountKind })} options={(['Bank', 'Cash'] as AccountKind[]).map((k) => ({ value: k, label: ACCOUNT_KIND_LABEL[k] }))} />
          {bank && <div className="grid grid-cols-2 gap-3">
            <FormField id="a-bank" label="Ngân hàng" maxLength={100} value={f.bankName ?? ''} onChange={(e) => setF({ ...f, bankName: e.target.value })} error={errors.bankName} />
            <FormField id="a-last4" label="4 số cuối TK" inputMode="numeric" maxLength={4} value={f.last4 ?? ''} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, '') })} error={errors.last4} />
          </div>}
          <div className="grid grid-cols-2 gap-3">
            <FormField id="a-open" label="Số dư đầu kỳ (đ)" inputMode="numeric" value={groupDigits(f.openingBalance)} onChange={(e) => setF({ ...f, openingBalance: parseMoney(e.target.value) })} error={errors.openingBalance} />
            <FormField id="a-date" label="Ngày đầu kỳ" type="date" required value={f.openingDate} onChange={(e) => setF({ ...f, openingDate: e.target.value })} error={errors.openingDate} />
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(c) => setF({ ...f, isActive: c === true })} /> Đang dùng (bỏ chọn = đóng quỹ, không ghi thêm giao dịch)</label>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LineDialog({ line, onClose }: { line: ILine | null | undefined; onClose: () => void }) {
  const [f, setF] = useState<ILineRequest>({ code: '', name: '', sortOrder: 0, isActive: true });
  const save = useFinanceMutation((b: ILineRequest) => financeApi.saveLine(line?.id, b));
  useEffect(() => { if (line !== undefined) { save.reset(); setF(line ? { code: line.code, name: line.name, sortOrder: line.sortOrder, isActive: line.isActive } : { code: '', name: '', sortOrder: 0, isActive: true }); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [line]);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={line !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{line ? `Sửa mảng ${line.code}` : 'Thêm mảng kinh doanh'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(f, { onSuccess: () => { toast.success('Đã lưu'); onClose(); }, onError: onErr }); }}>
          <FormField id="l-code" label="Mã *" required maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} error={errors.code} />
          <FormField id="l-name" label="Tên *" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(c) => setF({ ...f, isActive: c === true })} /> Đang dùng</label>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({ category, onClose }: { category: ICategory | null | undefined; onClose: () => void }) {
  const [f, setF] = useState<ICategoryRequest>({ name: '', kind: 'Expense', sortOrder: 0, isActive: true });
  const save = useFinanceMutation((b: ICategoryRequest) => financeApi.saveCategory(category?.id, b));
  useEffect(() => { if (category !== undefined) { save.reset(); setF(category ? { name: category.name, kind: category.kind, sortOrder: category.sortOrder, isActive: category.isActive } : { name: '', kind: 'Expense', sortOrder: 0, isActive: true }); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [category]);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={category !== undefined} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{category ? `Sửa danh mục ${category.name}` : 'Thêm danh mục'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(f, { onSuccess: () => { toast.success('Đã lưu'); onClose(); }, onError: onErr }); }}>
          <FormField id="c-name" label="Tên *" required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} />
          <SelectField id="c-kind" label="Loại" value={f.kind} onChange={(v) => setF({ ...f, kind: (v ?? 'Expense') as CategoryKind })} options={[{ value: 'Income', label: 'Thu' }, { value: 'Expense', label: 'Chi' }]} />
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive} onCheckedChange={(c) => setF({ ...f, isActive: c === true })} /> Đang dùng</label>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
