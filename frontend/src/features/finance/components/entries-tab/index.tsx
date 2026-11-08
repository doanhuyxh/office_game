import { useState } from 'react';
import { toast } from 'sonner';
import { Ban, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { downloadUrl, formatMoney } from '@/utils/money';
import { financeApi } from '../../api/finance.api';
import { useAccounts, useEntries, useFinanceMutation, useFinancePerms } from '../../hooks/useFinance';
import type { IEntry, IEntryFilter, TxKind } from '../../types/finance.types';
import { fmtDate, TX_KIND_LABEL, TX_KIND_TONE } from '../../utils/labels';
import { AttachmentButton } from '../attachment-button';
import { AttachmentsDialog } from '../attachments-dialog';
import { EntryFormDialog } from '../entry-form-dialog';

/** Sổ thu chi (quyền Xem). Người có quyền Ghi sổ: ghi mới + huỷ (kèm lý do; kỳ đã khoá thì không huỷ được) + chứng từ. Xuất Excel theo khoảng ngày / quỹ đang lọc. */
export function EntriesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const perms = useFinancePerms();
  const accounts = useAccounts().data ?? [];
  const [kind, setKind] = useState<TxKind | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [voided, setVoided] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDebounce(search, 300);
  const filter: IEntryFilter = { kind: kind ?? undefined, accountId: accountId ?? undefined, from: from || undefined, to: to || undefined, voided: voided || undefined, search: q || undefined };
  const pg = usePageState('finance-entries', JSON.stringify(filter));
  const { data, isLoading } = useEntries(filter, pg.query);
  const [voiding, setVoiding] = useState<IEntry | null>(null);
  const [docs, setDocs] = useState<IEntry | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder="Tìm diễn giải, đối tác, số hoá đơn…" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm" />
        <div className="w-36"><SelectField id="f-kind" label="Loại" allowEmpty emptyLabel="Tất cả" value={kind} onChange={(v) => setKind(v as TxKind | null)}
          options={(['Income', 'Expense', 'Transfer'] as TxKind[]).map((k) => ({ value: k, label: TX_KIND_LABEL[k] }))} /></div>
        <div className="w-48"><SelectField id="f-acc" label="Quỹ" allowEmpty emptyLabel="Tất cả" value={accountId} onChange={setAccountId} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></div>
        <div className="w-40"><FormField id="f-from" label="Từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><FormField id="f-to" label="Đến ngày" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <Button size="sm" variant="outline" className="mb-1" title="Sổ thu chi + sổ quỹ + tổng hợp (mặc định tháng này)"
          onClick={() => downloadUrl(financeApi.exportUrl({ from: from || undefined, to: to || undefined, accountId: accountId ?? undefined }))}><FileSpreadsheet /> Excel</Button>
        <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox checked={voided} onCheckedChange={(c) => setVoided(c === true)} /> Xem giao dịch đã huỷ</label>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ngày</TableHead><TableHead>Loại</TableHead><TableHead className="text-right">Số tiền</TableHead><TableHead>Quỹ</TableHead>
              <TableHead>Danh mục · Mảng</TableHead><TableHead>Diễn giải</TableHead><TableHead>Người ghi</TableHead><TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && data?.items.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Không có giao dịch</TableCell></TableRow>}
            {data?.items.map((e) => (
              <TableRow key={e.id} data-testid="entry-row">
                <TableCell className="whitespace-nowrap">{fmtDate(e.date)}</TableCell>
                <TableCell><StatusBadge tone={TX_KIND_TONE[e.kind]}>{TX_KIND_LABEL[e.kind]}</StatusBadge></TableCell>
                <TableCell className={`text-right font-medium tabular-nums whitespace-nowrap ${e.kind === 'Income' ? 'text-emerald-600' : e.kind === 'Expense' ? 'text-rose-600' : ''}`}>
                  {e.kind === 'Income' ? '+' : e.kind === 'Expense' ? '−' : ''}{formatMoney(e.amount)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{e.accountName}{e.toAccountName && ` → ${e.toAccountName}`}</TableCell>
                <TableCell className="text-sm">{e.categoryName ?? '—'}{e.businessLineName && <div className="text-xs text-muted-foreground">{e.businessLineName}</div>}
                  {e.projectName && <div className="text-xs text-primary">Dự án {e.projectName}</div>}</TableCell>
                <TableCell className="max-w-xs text-sm">
                  <div className="truncate" title={e.description ?? undefined}>{e.description ?? '—'}</div>
                  {(e.counterparty || e.invoiceNumber) && <div className="truncate text-xs text-muted-foreground">{[e.counterparty, e.invoiceNumber && `HĐ ${e.invoiceNumber}`].filter(Boolean).join(' · ')}</div>}
                  {e.status === 'Voided' && <div className="text-xs text-rose-600">Đã huỷ: {e.voidReason}</div>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{e.createdByName}</TableCell>
                <TableCell>
                  {e.status === 'Active' && <AttachmentButton count={e.attachmentCount} onClick={() => setDocs(e)} />}
                  {perms.record && e.status === 'Active' && (
                    <Button variant="ghost" size="icon" aria-label="Huỷ giao dịch" title="Huỷ giao dịch" onClick={() => setVoiding(e)}><Ban /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="giao dịch" />
      </div>
      <AttachmentsDialog owner={docs ? { type: 'Entry', id: docs.id } : null} title={docs ? `${fmtDate(docs.date)} · ${formatMoney(docs.amount)}` : ''}
        canUpload={perms.record && docs?.status === 'Active'} onClose={() => setDocs(null)} />
      <EntryFormDialog open={creating} onClose={onCreatedClose} />
      <VoidDialog entry={voiding} onClose={() => setVoiding(null)} />
    </div>
  );
}

function VoidDialog({ entry, onClose }: { entry: IEntry | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const run = useFinanceMutation((a: { id: string; reason: string }) => financeApi.voidEntry(a.id, a.reason));
  const errors = fieldErrors(run.error);
  return (
    <Dialog open={!!entry} onOpenChange={(o) => { if (!o) { setReason(''); run.reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Huỷ giao dịch {entry && `${TX_KIND_LABEL[entry.kind].toLowerCase()} ${formatMoney(entry.amount)} ngày ${fmtDate(entry.date)}`}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Giao dịch không bị xoá, chỉ không còn tính vào số dư. Huỷ giao dịch chi theo đề nghị → đề nghị trở lại "chờ chi".</p>
        <FormField id="void-reason" label="Lý do *" autoFocus maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
          <Button variant="destructive" disabled={run.isPending || !reason.trim()} onClick={() => entry && run.mutate({ id: entry.id, reason }, {
            onSuccess: () => { toast.success('Đã huỷ giao dịch'); setReason(''); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          })}>Huỷ giao dịch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
