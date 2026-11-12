import { useState } from 'react';
import { promptDialog } from '@/components/common/confirm-dialog';
import { toast } from 'sonner';
import { Ban, FilePlus2, Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate, todayVn } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { formatMoney, groupDigits, parseMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useContract, useSalesMutation } from '../../hooks/useSales';
import type { ContractStatus, IContractDetail, IInstallment, IInstallmentInput } from '../../types/sales.types';
import { BILLING, CONTRACT_NEXT_STATUS, CONTRACT_STATUS, INSTALLMENT_STATE } from '../../utils/labels';
import { AppendixDialog } from '../appendix-dialog';
import { CollectDialog } from '../collect-dialog';

const onErr = (err: unknown) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err));

/** Chi tiết hợp đồng bán: tổng giá trị / đã thu / còn nợ, phụ lục (tăng / giảm giá trị, từ yêu cầu thay đổi của dự án), lịch thu + lịch sử thu; kế toán ghi nhận thu, người phụ trách quản lý đợt + phụ lục. */
export function ContractSheet({ id, onClose, onOpenCustomer }: { id: string | null; onClose: () => void; onOpenCustomer: (id: string) => void }) {
  const { data, isLoading, error } = useContract(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl" data-testid="contract-sheet">
        {isLoading && <div className="p-6"><Spinner /></div>}
        {error && <div className="p-6 text-sm text-destructive">{errorMessage(error)}</div>}
        {data && <Detail key={data.contract.id} d={data} onOpenCustomer={onOpenCustomer} />}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ d, onOpenCustomer }: { d: IContractDetail; onOpenCustomer: (id: string) => void }) {
  const k = d.contract;
  const [collecting, setCollecting] = useState<IInstallment | null>(null);
  const [adding, setAdding] = useState<IInstallmentInput | null>(null);
  const [appendixOpen, setAppendixOpen] = useState(false);
  const cancelAppendix = useSalesMutation((a: { id: string; reason: string }) => salesApi.cancelAppendix(a.id, a.reason));
  const liveAppendices = d.appendices.filter((a) => !a.cancelled);
  const status = useSalesMutation((s: ContractStatus) => salesApi.updateContract(k.id, { title: k.title, status: s, endOn: k.endOn, note: d.note }));
  const cancel = useSalesMutation((a: { id: string; reason: string }) => salesApi.cancelInstallment(a.id, a.reason));
  const add = useSalesMutation((b: IInstallmentInput) => salesApi.addInstallment(k.id, b));
  const addErrors = fieldErrors(add.error);
  const free = k.totalValue - k.scheduled;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">{k.code} <StatusBadge tone={CONTRACT_STATUS[k.status].tone}>{CONTRACT_STATUS[k.status].label}</StatusBadge></SheetTitle>
        <SheetDescription>{k.title} · <button type="button" className="underline" onClick={() => onOpenCustomer(k.customerId)}>{k.customerName}</button> · Phụ trách: {k.ownerName}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 px-4 pb-6">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Giá trị (sau thuế)', formatMoney(k.totalValue), liveAppendices.length ? `Gốc ${formatMoney(d.originalTotalValue)} · ${liveAppendices.length} phụ lục` : `${formatMoney(d.valueBeforeTax)} + VAT ${d.vatRate}%`],
            ['Đã thu', formatMoney(k.collected), `${k.totalValue ? Math.round((k.collected / k.totalValue) * 100) : 0}%`],
            ['Còn phải thu', formatMoney(k.outstanding), k.overdue ? `Quá hạn ${formatMoney(k.overdue)}` : 'Không quá hạn'],
            ['Thời hạn', fmtDate(k.signedOn), k.endOn ? `đến ${fmtDate(k.endOn)}` : BILLING[k.billing]],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-lg border p-2"><div className="text-xs text-muted-foreground">{label}</div><div className="font-semibold tabular-nums">{value}</div>
              <div className={`text-xs ${label === 'Còn phải thu' && k.overdue ? 'text-rose-600' : 'text-muted-foreground'}`}>{sub}</div></div>
          ))}
        </div>
        {d.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{d.note}</p>}
        {d.canEdit && d.pendingChangeRequests.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" data-testid="pending-cr">
            <span>Khách đã đồng ý {d.pendingChangeRequests.length} thay đổi có tính tiền, chưa lập phụ lục: <b>{d.pendingChangeRequests.map((c) => c.code).join(', ')}</b></span>
            <Button size="sm" onClick={() => setAppendixOpen(true)}><FilePlus2 /> Lập phụ lục</Button>
          </div>
        )}
        {(d.appendices.length > 0 || (d.canEdit && k.status === 'Active')) && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between"><div className="text-sm font-medium">Phụ lục</div>
              {d.canEdit && k.status === 'Active' && <Button size="sm" variant="outline" onClick={() => setAppendixOpen(true)}><FilePlus2 /> Lập phụ lục</Button>}</div>
            {d.appendices.length === 0 && <p className="text-xs text-muted-foreground">Chưa có phụ lục. Tăng / giảm giá trị hợp đồng bằng phụ lục.</p>}
            {d.appendices.map((a) => (
              <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm ${a.cancelled ? 'opacity-60' : ''}`} data-testid="appendix-row">
                <div className="grid gap-0.5">
                  <div><b>{a.code}</b> · {a.title}{a.changeRequestCode && <span className="text-xs text-primary"> · từ {a.changeRequestCode}</span>}</div>
                  <div className="text-xs text-muted-foreground">Ký {fmtDate(a.signedOn)} · {a.createdByName}{a.cancelled && ` · Đã huỷ: ${a.cancelReason}`}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`tabular-nums font-medium ${a.totalDelta < 0 ? 'text-rose-600' : 'text-emerald-600'} ${a.cancelled ? 'line-through' : ''}`}>
                    {a.totalDelta > 0 ? '+' : '−'}{formatMoney(Math.abs(a.totalDelta))}</span>
                  {d.canEdit && !a.cancelled && k.status === 'Active' && (
                    <Button variant="ghost" size="icon" aria-label="Huỷ phụ lục" title="Huỷ phụ lục" onClick={async () => {
                      const reason = await promptDialog({ title: `Huỷ phụ lục ${a.code}?`, description: 'Các đợt thu của phụ lục cũng bị huỷ.',
                        label: 'Lý do huỷ', multiline: true, required: true, confirmText: 'Huỷ phụ lục', cancelText: 'Không', destructive: true });
                      if (reason) cancelAppendix.mutate({ id: a.id, reason }, { onSuccess: () => toast.success('Đã huỷ phụ lục'), onError: onErr });
                    }}><Ban /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead>Đợt</TableHead><TableHead>Hạn</TableHead><TableHead className="text-right">Số tiền</TableHead><TableHead className="text-right">Đã thu</TableHead>
              <TableHead>Trạng thái</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {d.installments.map((i) => {
                const hasMoney = i.collections.some((c) => c.active);
                return (
                  <TableRow key={i.id} className={i.state === 'Cancelled' ? 'opacity-60' : undefined}>
                    <TableCell className="text-sm"><div className="font-medium">{i.title}</div>
                      {i.collections.map((c) => <div key={c.id} className={`text-xs ${c.active ? 'text-muted-foreground' : 'text-rose-600 line-through'}`}>
                        {fmtDate(c.date)} · {formatMoney(c.amount)} · {c.createdByName}{!c.active && ' (dòng sổ đã huỷ)'}</div>)}
                      {i.cancelReason && <div className="text-xs text-muted-foreground">Huỷ: {i.cancelReason}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(i.dueOn)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(i.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.collected ? formatMoney(i.collected) : '—'}</TableCell>
                    <TableCell><StatusBadge tone={INSTALLMENT_STATE[i.state].tone}>{INSTALLMENT_STATE[i.state].label}{i.agingBucket && ` · ${i.agingBucket} ngày`}</StatusBadge></TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {d.canCollect && i.remaining > 0 && i.state !== 'Cancelled' && <Button size="sm" onClick={() => setCollecting(i)}>Thu tiền</Button>}
                      {d.canEdit && i.state !== 'Cancelled' && !hasMoney && (
                        <Button variant="ghost" size="icon" aria-label="Huỷ đợt" title="Huỷ đợt" onClick={async () => {
                          const reason = await promptDialog({ title: `Huỷ đợt "${i.title}"?`, label: 'Lý do huỷ', multiline: true, required: true,
                            confirmText: 'Huỷ đợt', cancelText: 'Không', destructive: true });
                          if (reason) cancel.mutate({ id: i.id, reason }, { onSuccess: () => toast.success('Đã huỷ đợt'), onError: onErr });
                        }}><Ban /></Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {d.canEdit && k.status === 'Active' && (adding ? (
          <form className="grid gap-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); add.mutate(adding, { onSuccess: () => { toast.success('Đã thêm đợt'); setAdding(null); }, onError: onErr }); }}>
            <div className="text-xs text-muted-foreground">Còn trống trong giá trị hợp đồng: {formatMoney(free)} (tăng giá trị: lập phụ lục)</div>
            <div className="grid grid-cols-[1fr_9.5rem_9rem] gap-2">
              <Input aria-label="Tên đợt" required value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
              <Input aria-label="Hạn" type="date" required value={adding.dueOn} onChange={(e) => setAdding({ ...adding, dueOn: e.target.value })} />
              <Input aria-label="Số tiền" inputMode="numeric" value={groupDigits(adding.amount)} onChange={(e) => setAdding({ ...adding, amount: parseMoney(e.target.value) })} />
            </div>
            {Object.values(addErrors).map((m) => <p key={m} className="text-xs text-destructive">{m}</p>)}
            <div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setAdding(null)}>Huỷ</Button><Button type="submit" size="sm" disabled={add.isPending}>Thêm đợt</Button></div>
          </form>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-2">
            <Button size="sm" variant="outline" disabled={free <= 0} onClick={() => { add.reset(); setAdding({ title: `Đợt ${d.installments.length + 1}`, dueOn: todayVn(), amount: free }); }}><Plus /> Thêm đợt thu</Button>
            <div className="w-48"><SelectField id="k-status" label="Trạng thái hợp đồng" value={k.status} onChange={(v) => v && v !== k.status && status.mutate(v as ContractStatus, { onSuccess: () => toast.success('Đã cập nhật'), onError: onErr })}
              options={CONTRACT_NEXT_STATUS[k.status].map((s) => ({ value: s, label: CONTRACT_STATUS[s].label }))} /></div>
          </div>
        ))}
        {d.canEdit && k.status === 'Completed' && <div className="w-48"><SelectField id="k-status2" label="Trạng thái hợp đồng" value={k.status}
          onChange={(v) => v && v !== k.status && status.mutate(v as ContractStatus, { onSuccess: () => toast.success('Đã cập nhật'), onError: onErr })}
          options={CONTRACT_NEXT_STATUS[k.status].map((s) => ({ value: s, label: CONTRACT_STATUS[s].label }))} /></div>}
        <p className="text-xs text-muted-foreground">File hợp đồng đã ký lưu ở Tài liệu. Tiền thu ghi vào sổ thu chi; kế toán huỷ dòng thu ở sổ thì số đã thu ở đây tự trừ.</p>
      </div>
      <CollectDialog installment={collecting} contractCode={k.code} onClose={() => setCollecting(null)} />
      <AppendixDialog d={d} open={appendixOpen} onClose={() => setAppendixOpen(false)} />
    </>
  );
}
