import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate, todayVn } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useCustomer, useSalesMutation } from '../../hooks/useSales';
import type { ActivityKind, IActivityRequest, IContactRequest, ICustomerDetail, IOpportunity } from '../../types/sales.types';
import { ACTIVITY_KIND, CONTRACT_STATUS, CUSTOMER_KIND, STAGE } from '../../utils/labels';
import { ContractFormDialog } from '../contract-form-dialog';
import { CustomerFormDialog } from '../customer-form-dialog';
import { OpportunityFormDialog } from '../opportunity-form-dialog';

const onErr = (err: unknown) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err));
const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{title}</h3>{action}</div>
      {children}
    </section>
  );
}

/** Chi tiết khách hàng: thông tin, người liên hệ, nhật ký chăm sóc, cơ hội, hợp đồng. */
export function CustomerSheet({ id, onClose, onOpenContract }: { id: string | null; onClose: () => void; onOpenContract: (id: string) => void }) {
  const { data, isLoading, error } = useCustomer(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="customer-sheet">
        {isLoading && <div className="p-6"><Spinner /></div>}
        {error && <div className="p-6 text-sm text-destructive">{errorMessage(error)}</div>}
        {data && <Detail key={data.customer.id} d={data} onOpenContract={onOpenContract} />}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ d, onOpenContract }: { d: ICustomerDetail; onOpenContract: (id: string) => void }) {
  const c = d.customer;
  const [editing, setEditing] = useState(false);
  const [opp, setOpp] = useState<IOpportunity | null | undefined>(undefined);
  const [contracting, setContracting] = useState(false);
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">{c.name} <span className="text-sm font-normal text-muted-foreground">{c.code}</span>
          {!c.isActive && <StatusBadge tone="muted">Ngừng</StatusBadge>}</SheetTitle>
        <SheetDescription>{CUSTOMER_KIND[c.kind]} · Phụ trách: {c.ownerName}{c.source && ` · Nguồn: ${c.source}`}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-6 px-4 pb-6">
        <div className="grid gap-1 rounded-lg border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="grid gap-1">
              {c.taxCode && <div>MST: {c.taxCode}</div>}
              {(c.phone || c.email) && <div>{[c.phone, c.email].filter(Boolean).join(' · ')}</div>}
              {d.address && <div>{d.address}</div>}
              {d.note && <div className="whitespace-pre-wrap text-muted-foreground">{d.note}</div>}
              {!c.taxCode && !c.phone && !c.email && !d.address && !d.note && <div className="text-muted-foreground">Chưa có thông tin liên lạc</div>}
            </div>
            {d.canEdit && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>}
          </div>
        </div>
        <Contacts d={d} />
        <Activities d={d} />
        <Section title={`Cơ hội (${d.opportunities.length})`} action={d.canEdit && <Button size="sm" variant="outline" onClick={() => setOpp(null)}><Plus /> Thêm</Button>}>
          {d.opportunities.length === 0 && <p className="text-sm text-muted-foreground">Chưa có cơ hội</p>}
          {d.opportunities.map((o) => (
            <button key={o.id} type="button" className="flex items-center justify-between gap-2 rounded-lg border p-2 text-left text-sm hover:bg-muted/50" onClick={() => setOpp(o)} disabled={!d.canEdit}>
              <span><span className="font-medium">{o.title}</span><span className="block text-xs text-muted-foreground">{o.ownerName}{o.expectedCloseOn && ` · dự kiến ${fmtDate(o.expectedCloseOn)}`}</span></span>
              <span className="flex items-center gap-2 whitespace-nowrap"><span className="tabular-nums">{formatMoney(o.value)}</span><StatusBadge tone={STAGE[o.stage].tone}>{STAGE[o.stage].label}</StatusBadge></span>
            </button>
          ))}
        </Section>
        <Section title={`Hợp đồng (${d.contracts.length})`} action={d.canEdit && <Button size="sm" variant="outline" onClick={() => setContracting(true)}><Plus /> Tạo hợp đồng</Button>}>
          {d.contracts.length === 0 && <p className="text-sm text-muted-foreground">Chưa có hợp đồng</p>}
          {d.contracts.map((k) => (
            <button key={k.id} type="button" className="flex items-center justify-between gap-2 rounded-lg border p-2 text-left text-sm hover:bg-muted/50" onClick={() => onOpenContract(k.id)}>
              <span><span className="font-medium">{k.code}</span> · {k.title}<span className="block text-xs text-muted-foreground">Ký {fmtDate(k.signedOn)} · đã thu {formatMoney(k.collected)} / {formatMoney(k.totalValue)}</span></span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                {k.overdue > 0 && <StatusBadge tone="danger">Quá hạn {formatMoney(k.overdue)}</StatusBadge>}
                <StatusBadge tone={CONTRACT_STATUS[k.status].tone}>{CONTRACT_STATUS[k.status].label}</StatusBadge>
              </span>
            </button>
          ))}
        </Section>
      </div>
      <CustomerFormDialog open={editing} detail={d} onClose={() => setEditing(false)} />
      <OpportunityFormDialog opportunity={opp} customerId={c.id} onClose={() => setOpp(undefined)} />
      <ContractFormDialog open={contracting} customerId={c.id} opportunities={d.opportunities} onClose={() => setContracting(false)} onCreated={onOpenContract} />
    </>
  );
}

function Contacts({ d }: { d: ICustomerDetail }) {
  const [form, setForm] = useState<(IContactRequest & { id?: string }) | null>(null);
  const save = useSalesMutation((b: IContactRequest & { id?: string }): Promise<unknown> => (b.id ? salesApi.updateContact(b.id, b) : salesApi.addContact(d.customer.id, b)));
  const remove = useSalesMutation(salesApi.deleteContact);
  const errors = fieldErrors(save.error);
  return (
    <Section title={`Người liên hệ (${d.contacts.length})`} action={d.canEdit && !form && <Button size="sm" variant="outline" onClick={() => { save.reset(); setForm({ name: '' }); }}><Plus /> Thêm</Button>}>
      {d.contacts.length === 0 && !form && <p className="text-sm text-muted-foreground">Chưa có người liên hệ</p>}
      {d.contacts.map((x) => (
        <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
          <span>{x.isPrimary && <Star className="mr-1 inline size-3.5 fill-amber-400 text-amber-400" aria-label="Liên hệ chính" />}<span className="font-medium">{x.name}</span>
            {x.title && <span className="text-muted-foreground"> · {x.title}</span>}<span className="block text-xs text-muted-foreground">{[x.phone, x.email].filter(Boolean).join(' · ') || '—'}</span></span>
          {d.canEdit && <span className="flex">
            <Button variant="ghost" size="icon" aria-label="Sửa" onClick={() => { save.reset(); setForm({ ...x, title: x.title ?? '', phone: x.phone ?? '', email: x.email ?? '' }); }}><Pencil /></Button>
            <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => confirm(`Xoá liên hệ ${x.name}?`) && remove.mutate(x.id, { onError: onErr })}><Trash2 /></Button>
          </span>}
        </div>
      ))}
      {form && (
        <form className="grid gap-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form, { onSuccess: () => setForm(null), onError: onErr }); }}>
          <div className="grid grid-cols-2 gap-2">
            <FormField id="ct-name" label="Họ tên *" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            <FormField id="ct-title" label="Chức vụ" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <FormField id="ct-phone" label="Điện thoại" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={errors.phone} />
            <FormField id="ct-email" label="Email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} /> Liên hệ chính</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setForm(null)}>Huỷ</Button><Button type="submit" size="sm" disabled={save.isPending}>Lưu</Button></div>
        </form>
      )}
    </Section>
  );
}

function Activities({ d }: { d: ICustomerDetail }) {
  const blank: IActivityRequest = { kind: 'Call', content: '', nextAction: '', nextActionOn: '' };
  const [f, setF] = useState<IActivityRequest | null>(null);
  const save = useSalesMutation((b: IActivityRequest) => salesApi.addActivity(d.customer.id, b));
  const errors = fieldErrors(save.error);
  return (
    <Section title="Chăm sóc khách" action={d.canEdit && !f && <Button size="sm" variant="outline" onClick={() => { save.reset(); setF(blank); }}><Plus /> Ghi chăm sóc</Button>}>
      {f && (
        <form className="grid gap-2 rounded-lg border p-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, nextAction: f.nextAction || null, nextActionOn: f.nextActionOn || null }, { onSuccess: () => { toast.success('Đã ghi'); setF(null); }, onError: onErr });
        }}>
          <SelectField id="ac-kind" label="Hình thức" value={f.kind} onChange={(v) => setF({ ...f, kind: (v ?? 'Call') as ActivityKind })}
            options={(Object.keys(ACTIVITY_KIND) as ActivityKind[]).map((k) => ({ value: k, label: ACTIVITY_KIND[k] }))} />
          <Textarea aria-label="Nội dung" placeholder="Nội dung trao đổi…" required rows={3} maxLength={2000} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />
          {errors.content && <p className="text-xs text-destructive">{errors.content}</p>}
          <div className="grid grid-cols-[1fr_10rem] gap-2">
            <FormField id="ac-next" label="Việc tiếp theo" placeholder="Gửi báo giá…" maxLength={300} value={f.nextAction ?? ''} onChange={(e) => setF({ ...f, nextAction: e.target.value })} error={errors.nextAction} />
            <FormField id="ac-next-on" label="Hẹn ngày" type="date" min={todayVn()} value={f.nextActionOn ?? ''} onChange={(e) => setF({ ...f, nextActionOn: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setF(null)}>Huỷ</Button><Button type="submit" size="sm" disabled={save.isPending}>Lưu</Button></div>
        </form>
      )}
      {d.activities.length === 0 && !f && <p className="text-sm text-muted-foreground">Chưa có nhật ký chăm sóc</p>}
      <ol className="grid gap-2">
        {d.activities.map((a) => (
          <li key={a.id} className="rounded-lg border p-2 text-sm">
            <div className="text-xs text-muted-foreground">{ACTIVITY_KIND[a.kind]} · {fmtTime(a.at)} · {a.createdByName}</div>
            <div className="whitespace-pre-wrap">{a.content}</div>
            {a.nextAction && <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">→ {a.nextAction}{a.nextActionOn && ` (hẹn ${fmtDate(a.nextActionOn)})`}</div>}
          </li>
        ))}
      </ol>
    </Section>
  );
}
