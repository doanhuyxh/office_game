import { confirmDialog, promptDialog } from '@/components/common/confirm-dialog';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Ban, CheckCircle2, CopyPlus, FileDown, FileSignature, Pencil, Send, XCircle } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { PATHS } from '@/config/paths';
import { fmtDate } from '@/features/finance';
import { errorMessage } from '@/utils/errors';
import { downloadUrl, formatMoney } from '@/utils/money';
import { salesApi } from '../../api/sales.api';
import { useQuote, useSalesMutation } from '../../hooks/useSales';
import type { IQuoteDetail } from '../../types/sales.types';
import { QUOTE_STATUS } from '../../utils/labels';
import { ContractFormDialog } from '../contract-form-dialog';
import { QuoteFormDialog } from '../quote-form-dialog';

const onErr = (err: unknown) => toast.error(errorMessage(err));

/**
 * Chi tiết báo giá: hạng mục, tổng, phiên bản; hành động theo trạng thái (sửa nháp → chốt / gửi duyệt chiết khấu → đã gửi → khách đồng ý / từ chối,
 * phiên bản mới, huỷ), tải Word theo mẫu, lập hợp đồng bán từ báo giá đã được đồng ý.
 */
export function QuoteSheet({ id, onClose, onOpen, onOpenContract }: { id: string | null; onClose: () => void; onOpen: (id: string) => void; onOpenContract: (id: string) => void }) {
  const { data, isLoading, error } = useQuote(id);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl" data-testid="quote-sheet">
        {isLoading && <div className="p-6"><Spinner /></div>}
        {error && <div className="p-6 text-sm text-destructive">{errorMessage(error)}</div>}
        {data && <Detail key={data.quote.id} d={data} onOpen={onOpen} onOpenContract={onOpenContract} />}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ d, onOpen, onOpenContract }: { d: IQuoteDetail; onOpen: (id: string) => void; onOpenContract: (id: string) => void }) {
  const q = d.quote;
  const [editing, setEditing] = useState(false);
  const [contracting, setContracting] = useState(false);
  const submit = useSalesMutation(() => salesApi.submitQuote(q.id));
  const sent = useSalesMutation(() => salesApi.quoteSent(q.id));
  const result = useSalesMutation((a: { accepted: boolean; note: string | null }) => salesApi.quoteResult(q.id, a.accepted, a.note));
  const revise = useSalesMutation(() => salesApi.reviseQuote(q.id));
  const cancel = useSalesMutation(() => salesApi.cancelQuote(q.id));
  const can = d.canEdit;
  const s = q.status;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">{q.code} <StatusBadge tone={QUOTE_STATUS[s].tone}>{QUOTE_STATUS[s].label}</StatusBadge>
          {q.expired && <StatusBadge tone="danger">Hết hiệu lực</StatusBadge>}</SheetTitle>
        <SheetDescription>{q.title} · {q.customerName} · Phụ trách: {q.ownerName} · {fmtDate(q.issuedOn)} → {fmtDate(q.validUntil)}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-6">
        {d.approvalComment && s === 'Draft' && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-sm">Không được duyệt chiết khấu: {d.approvalComment}</p>}
        {s === 'PendingApproval' && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm">Chiết khấu {q.discountPercent}% vượt ngưỡng {d.discountLimitPercent}% — đang chờ
          người có quyền Duyệt chi. <Link to={PATHS.approvals} className="underline">Xem luồng duyệt</Link></p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadUrl(salesApi.quoteDocxUrl(q.id))}><FileDown /> Tải Word</Button>
          {can && s === 'Draft' && <>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>
            <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate(undefined, {
              onSuccess: (r) => toast.success(r.status === 'PendingApproval' ? 'Đã gửi duyệt chiết khấu' : 'Đã chốt — sẵn sàng gửi khách'), onError: onErr })}>
              <Send /> {d.needsApproval ? 'Gửi duyệt chiết khấu' : 'Chốt báo giá'}</Button>
          </>}
          {can && s === 'Ready' && <Button size="sm" onClick={() => sent.mutate(undefined, { onSuccess: () => toast.success('Đã đánh dấu gửi khách'), onError: onErr })}><Send /> Đã gửi khách</Button>}
          {can && (s === 'Ready' || s === 'Sent') && <>
            <Button size="sm" variant="outline" onClick={() => result.mutate({ accepted: true, note: null }, { onSuccess: () => toast.success('Khách đồng ý — lập hợp đồng'), onError: onErr })}><CheckCircle2 /> Khách đồng ý</Button>
            <Button size="sm" variant="outline" onClick={async () => { const note = await promptDialog({ title: 'Khách từ chối báo giá', label: 'Lý do (không bắt buộc)', multiline: true, confirmText: 'Ghi nhận từ chối' }); if (note !== null) result.mutate({ accepted: false, note }, { onError: onErr }); }}><XCircle /> Khách từ chối</Button>
          </>}
          {can && s === 'Accepted' && !q.contractId && <Button size="sm" onClick={() => setContracting(true)}><FileSignature /> Lập hợp đồng</Button>}
          {can && ['Draft', 'Ready', 'Sent', 'Rejected'].includes(s) && <Button size="sm" variant="outline" onClick={() => revise.mutate(undefined, {
            onSuccess: (id) => { toast.success('Đã tạo phiên bản mới'); onOpen(id); }, onError: onErr })}><CopyPlus /> Phiên bản mới</Button>}
          {can && ['Draft', 'Ready', 'Sent'].includes(s) && <Button size="sm" variant="ghost" onClick={async () => await confirmDialog({ title: `Huỷ báo giá ${q.code}?`, confirmText: 'Huỷ báo giá', cancelText: 'Không', destructive: true }) && cancel.mutate(undefined, { onError: onErr })}><Ban /> Huỷ</Button>}
          {q.contractId && <Button size="sm" variant="link" onClick={() => onOpenContract(q.contractId!)}>Xem hợp đồng</Button>}
        </div>
        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="w-10">#</TableHead><TableHead>Hạng mục</TableHead><TableHead>ĐVT</TableHead><TableHead className="text-right">SL</TableHead>
              <TableHead className="text-right">Đơn giá</TableHead><TableHead className="text-right">Thành tiền</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.lines.map((l) => (
                <TableRow key={l.id}><TableCell>{l.order}</TableCell><TableCell className="text-sm">{l.description}</TableCell><TableCell>{l.unit ?? ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.quantity.toLocaleString('vi-VN')}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.unitPrice)}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(l.amount)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="grid justify-end gap-0.5 p-3 text-right text-sm tabular-nums">
            <span>Cộng: {formatMoney(q.subtotal)}</span>
            {q.discount > 0 && <span>Chiết khấu {q.discountPercent}%: −{formatMoney(q.discount)}</span>}
            <span>Trước thuế: {formatMoney(q.beforeTax)} · VAT {q.vatRate}%: {formatMoney(q.vat)}</span>
            <span className="text-base font-semibold">Tổng cộng: {formatMoney(q.total)}</span>
          </div>
        </div>
        {d.terms && <div className="text-sm"><div className="font-medium">Điều khoản</div><p className="whitespace-pre-wrap text-muted-foreground">{d.terms}</p></div>}
        {d.note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{d.note}</p>}
        {(d.sentAt || d.decidedOn) && <p className="text-xs text-muted-foreground">{d.sentAt && `Gửi khách ${fmtDate(d.sentAt.slice(0, 10))}. `}
          {d.decidedOn && `Khách trả lời ${fmtDate(d.decidedOn)}${d.decisionNote ? `: ${d.decisionNote}` : ''}.`}</p>}
        {d.versions.length > 1 && (
          <div className="grid gap-1 text-sm"><div className="font-medium">Các phiên bản</div>
            {d.versions.map((v) => (
              <button key={v.id} type="button" disabled={v.id === q.id} className="flex items-center justify-between rounded-md px-2 py-1 text-left hover:bg-muted disabled:font-semibold disabled:hover:bg-transparent"
                onClick={() => onOpen(v.id)}><span>v{v.version} · {fmtDate(v.createdAt.slice(0, 10))} · <StatusBadge tone={QUOTE_STATUS[v.status].tone}>{QUOTE_STATUS[v.status].label}</StatusBadge></span>
                <span className="tabular-nums">{formatMoney(v.total)}</span></button>
            ))}
          </div>
        )}
      </div>
      <QuoteFormDialog open={editing} quote={d} onClose={() => setEditing(false)} />
      <ContractFormDialog open={contracting} customerId={q.customerId} fromQuote={d} onClose={() => setContracting(false)} onCreated={onOpenContract} />
    </>
  );
}
