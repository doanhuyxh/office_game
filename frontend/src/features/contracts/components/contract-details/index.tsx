import { useRef, useState } from 'react';
import { FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Textarea } from '@/components/common/textarea';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { contractApi } from '../../api/contract.api';
import { useAddAmendment, useDeleteAmendment, useUploadContractFile } from '../../hooks/useContracts';
import type { IContract, ICreateAmendment, IStoredFile } from '../../types/contract.types';
import { ACCEPT_FILES, CONTRACT_STATUS, CONTRACT_TYPE, EXPIRING_DAYS, formatMoney } from '../../utils/labels';

/** Mở file qua presigned URL (hết hạn sau vài phút) — không lưu link. */
async function openFile(contractId: string, amendmentId?: string) {
  try {
    const { url } = await contractApi.fileUrl(contractId, amendmentId);
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export function ContractStatusBadge({ c }: { c: IContract }) {
  const s = CONTRACT_STATUS[c.status];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      {c.daysLeft != null && c.daysLeft <= EXPIRING_DAYS && <StatusBadge tone="warning">Còn {c.daysLeft} ngày</StatusBadge>}
    </span>
  );
}

function FileButton({ file, canUpload, onOpen, onUpload, busy }: {
  file: IStoredFile | null; canUpload: boolean; onOpen: () => void; onUpload: (f: File) => void; busy: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {file ? (
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onOpen}><Paperclip /> {file.name}</Button>
      ) : (
        <span className="text-xs text-muted-foreground">Chưa có file</span>
      )}
      {canUpload && (
        <>
          <input ref={input} type="file" accept={ACCEPT_FILES} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busy} onClick={() => input.current?.click()}>
            <Upload /> {file ? 'Thay file' : 'Tải file lên'}
          </Button>
        </>
      )}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AmendmentDialog({ contract, open, onClose }: { contract: IContract; open: boolean; onClose: () => void }) {
  const add = useAddAmendment();
  const [f, setF] = useState<ICreateAmendment>({ number: '', effectiveDate: '', content: '', salary: null, allowance: null });
  const errors = fieldErrors(add.error);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add.mutate({ id: contract.id, body: f }, {
      onSuccess: () => { toast.success('Đã thêm phụ lục'); setF({ number: '', effectiveDate: '', content: '', salary: null, allowance: null }); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Thêm phụ lục · {contract.number}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <p className="text-xs text-muted-foreground">Phụ lục không được sửa thời hạn hợp đồng (BLLĐ 2019 Điều 22). Để trống lương nếu không đổi.</p>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="a-number" label="Số phụ lục *" required maxLength={50} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} error={errors.number} />
            <FormField id="a-date" label="Hiệu lực từ *" type="date" required value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} error={errors.effectiveDate} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="a-content">Nội dung *</Label>
            <Textarea id="a-content" rows={3} maxLength={2000} required value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Vd: Điều chỉnh lương từ 01/04/2026" />
            {errors.content && <p className="text-xs text-destructive">{errors.content}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="a-salary" label="Lương mới (VNĐ)" type="number" min={0} step={1000} value={f.salary ?? ''} onChange={(e) => setF({ ...f, salary: num(e.target.value) })} error={errors.salary} />
            <FormField id="a-allowance" label="Phụ cấp mới (VNĐ)" type="number" min={0} step={1000} value={f.allowance ?? ''} onChange={(e) => setF({ ...f, allowance: num(e.target.value) })} error={errors.allowance} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={add.isPending}>Thêm phụ lục</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Thông tin một hợp đồng + phụ lục + file. `canEdit` (HR): tải file lên, thêm / xoá phụ lục. Nhân viên: chỉ xem / tải file. */
export function ContractDetails({ contract: c, canEdit }: { contract: IContract; canEdit: boolean }) {
  const upload = useUploadContractFile();
  const removeAmendment = useDeleteAmendment();
  const [adding, setAdding] = useState(false);
  const doUpload = (file: File, amendmentId?: string) =>
    upload.mutate({ id: c.id, file, amendmentId }, { onSuccess: () => toast.success('Đã tải file lên'), onError: (e) => toast.error(errorMessage(e)) });

  return (
    <div className="grid gap-5">
      <dl className="divide-y">
        <Row label="Nhân viên">{c.employee.code} · {c.employee.fullName}{c.employee.departmentName && <span className="text-muted-foreground"> ({c.employee.departmentName})</span>}</Row>
        <Row label="Loại">{CONTRACT_TYPE[c.type]}</Row>
        <Row label="Trạng thái"><ContractStatusBadge c={c} /></Row>
        <Row label="Thời hạn">{formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : 'không xác định'}{c.signedDate && <span className="text-muted-foreground"> · ký {formatDate(c.signedDate)}</span>}</Row>
        {c.terminatedOn && <Row label="Chấm dứt">{formatDate(c.terminatedOn)} — {c.terminationReason}</Row>}
        {c.jobTitle && <Row label="Chức danh">{c.jobTitle}</Row>}
        <Row label="Lương hiện tại">
          <b>{formatMoney(c.currentSalary)}</b>{c.currentAllowance != null && <span className="text-muted-foreground"> + phụ cấp {formatMoney(c.currentAllowance)}</span>}
          {c.currentSalary !== c.salary && <div className="text-xs text-muted-foreground">Trên hợp đồng: {formatMoney(c.salary)} (đã đổi theo phụ lục)</div>}
        </Row>
        {c.note && <Row label="Ghi chú"><span className="whitespace-pre-line">{c.note}</span></Row>}
        <Row label="File hợp đồng">
          <FileButton file={c.file} canUpload={canEdit} busy={upload.isPending} onOpen={() => openFile(c.id)} onUpload={(f) => doUpload(f)} />
        </Row>
      </dl>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" /> Phụ lục ({c.amendments.length})</h4>
          {canEdit && <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus /> Thêm phụ lục</Button>}
        </div>
        {c.amendments.length === 0 && <p className="text-sm text-muted-foreground">Chưa có phụ lục.</p>}
        {c.amendments.map((a) => (
          <div key={a.id} className="grid gap-1 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{a.number} · hiệu lực {formatDate(a.effectiveDate)}</b>
              {canEdit && (
                <Button size="icon" variant="ghost" className="size-7" aria-label="Xoá phụ lục" disabled={removeAmendment.isPending}
                  onClick={() => confirm(`Xoá phụ lục ${a.number}?`) && removeAmendment.mutate({ id: c.id, amendmentId: a.id }, { onError: (e) => toast.error(errorMessage(e)) })}>
                  <Trash2 />
                </Button>
              )}
            </div>
            <p className="whitespace-pre-line text-muted-foreground">{a.content}</p>
            {(a.salary != null || a.allowance != null) && (
              <p>Lương: {formatMoney(a.salary ?? c.salary)}{a.allowance != null && ` · phụ cấp ${formatMoney(a.allowance)}`}</p>
            )}
            <FileButton file={a.file} canUpload={canEdit} busy={upload.isPending} onOpen={() => openFile(c.id, a.id)} onUpload={(f) => doUpload(f, a.id)} />
          </div>
        ))}
      </div>
      {canEdit && <AmendmentDialog contract={c} open={adding} onClose={() => setAdding(false)} />}
    </div>
  );
}
