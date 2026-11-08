import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate, todayVn } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useChangeRequests, useProjectMutation } from '../../hooks/useProjects';
import type { ChangeRequestStatus, IChangeRequest, IChangeRequestRequest, IProjectDetail } from '../../types/project.types';
import { CR_STATUS } from '../../utils/labels';

const onErr = (err: unknown) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err));
const editable = (s: ChangeRequestStatus) => s === 'Draft' || s === 'Sent';

/**
 * Yêu cầu thay đổi (CR): quản lý dự án ghi phát sinh + ngày công ước tính (không nhập tiền). Khách đồng ý → cộng vào ngân sách ngày công;
 * có tính tiền → người phụ trách hợp đồng + kế toán được báo để lập phụ lục (module Kinh doanh).
 */
export function ChangeRequestsPanel({ d }: { d: IProjectDetail }) {
  const p = d.project;
  const { data = [], isLoading, error } = useChangeRequests(p.id);
  const [edit, setEdit] = useState<IChangeRequest | null | undefined>(undefined);
  const [deciding, setDeciding] = useState<{ cr: IChangeRequest; status: ChangeRequestStatus } | null>(null);
  const move = useProjectMutation((a: { id: string; status: ChangeRequestStatus }) => projectApi.moveChangeRequest(a.id, a.status));
  const canEdit = p.canManage && p.status === 'Active';
  if (isLoading) return <Spinner />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Phát sinh ngoài phạm vi. Khách đồng ý → cộng ngày công vào ngân sách{p.budgetManDays == null ? ' (dự án chưa đặt ngân sách nên không cộng)' : ''}; có tính tiền → kế toán / người phụ trách hợp đồng lập phụ lục.</p>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(null)}><Plus /> Yêu cầu thay đổi</Button>}
      </div>
      {data.length === 0 && <p className="text-sm text-muted-foreground">Chưa có yêu cầu thay đổi.</p>}
      {data.map((c) => (
        <div key={c.id} className="grid gap-2 rounded-xl border bg-card p-3" data-testid="cr-row">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="grid gap-0.5 text-sm">
              <div className="flex flex-wrap items-center gap-2 font-medium"><span className="text-muted-foreground">{c.code}</span> {c.title}
                <StatusBadge tone={CR_STATUS[c.status].tone}>{CR_STATUS[c.status].label}</StatusBadge>
                {c.billable && <StatusBadge tone="warning">Tính tiền</StatusBadge>}</div>
              <div className="text-xs text-muted-foreground">
                {c.estimateManDays != null && `${c.estimateManDays.toLocaleString('vi-VN')} ngày công · `}{c.createdByName} {fmtDate(c.createdAt.slice(0, 10))}
                {c.sentOn && ` · gửi ${fmtDate(c.sentOn)}`}{c.decidedOn && ` · quyết ${fmtDate(c.decidedOn)}`}
                {c.budgetAddedManDays != null && ` · đã cộng ${c.budgetAddedManDays.toLocaleString('vi-VN')} ngày vào ngân sách`}
              </div>
              {c.description && <p className="whitespace-pre-wrap text-sm">{c.description}</p>}
              {c.decisionNote && <p className="text-xs text-muted-foreground">Ghi chú: {c.decisionNote}</p>}
              {c.appendix ? <p className="text-xs text-emerald-600">Đã lập phụ lục {c.appendix.code} (HĐ {c.appendix.contractCode}, ký {fmtDate(c.appendix.signedOn)})</p>
                : c.status === 'Approved' && c.billable && <p className="text-xs text-amber-600">Chờ người phụ trách hợp đồng / kế toán lập phụ lục</p>}
            </div>
            {canEdit && editable(c.status) && (
              <div className="flex flex-wrap gap-1">
                {c.status === 'Draft' && <Button size="sm" variant="outline" onClick={() => move.mutate({ id: c.id, status: 'Sent' }, { onSuccess: () => toast.success('Đã đánh dấu gửi khách'), onError: onErr })}>Đã gửi khách</Button>}
                <Button size="sm" onClick={() => setDeciding({ cr: c, status: 'Approved' })}>Khách đồng ý</Button>
                <Button size="sm" variant="outline" onClick={() => setDeciding({ cr: c, status: 'Rejected' })}>Từ chối</Button>
                <Button size="sm" variant="ghost" onClick={() => confirm(`Huỷ yêu cầu ${c.code}?`) && move.mutate({ id: c.id, status: 'Cancelled' }, { onError: onErr })}>Huỷ</Button>
                <Button size="icon" variant="ghost" aria-label="Sửa" onClick={() => setEdit(c)}><Pencil /></Button>
              </div>
            )}
          </div>
        </div>
      ))}
      <CrDialog projectId={p.id} cr={edit} hasContracts={p.contracts.length > 0} onClose={() => setEdit(undefined)} />
      <DecideDialog value={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}

function CrDialog({ projectId, cr, hasContracts, onClose }: { projectId: string; cr: IChangeRequest | null | undefined; hasContracts: boolean; onClose: () => void }) {
  const open = cr !== undefined;
  const [f, setF] = useState<IChangeRequestRequest>({ title: '', billable: false });
  const save = useProjectMutation((b: IChangeRequestRequest) => projectApi.saveChangeRequest(projectId, cr?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    setF(cr ? { title: cr.title, description: cr.description ?? '', estimateManDays: cr.estimateManDays, billable: cr.billable } : { title: '', description: '', estimateManDays: null, billable: hasContracts });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, cr?.id]);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{cr ? `Sửa ${cr.code}` : 'Yêu cầu thay đổi'}</DialogTitle>
          <DialogDescription>Ghi phần việc phát sinh và ngày công ước tính. Số tiền do người phụ trách hợp đồng / kế toán nhập ở phụ lục.</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, description: f.description || null }, { onSuccess: () => { toast.success('Đã lưu'); onClose(); }, onError: onErr });
        }}>
          <FormField id="cr-title" label="Tên thay đổi *" required autoFocus maxLength={300} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errors.title} />
          <div className="grid gap-2">
            <Label htmlFor="cr-desc">Mô tả</Label>
            <Textarea id="cr-desc" rows={4} maxLength={5000} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <FormField id="cr-days" label="Ngày công ước tính" type="number" min={0} step="0.5" value={f.estimateManDays ?? ''}
            onChange={(e) => setF({ ...f, estimateManDays: e.target.value === '' ? null : Number(e.target.value) })} error={errors.estimateManDays} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} />
            Tính tiền khách (cần phụ lục hợp đồng){!hasContracts && ' — dự án chưa gắn hợp đồng bán'}</label>
          {errors.billable && <p className="text-xs text-destructive">{errors.billable}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DecideDialog({ value, onClose }: { value: { cr: IChangeRequest; status: ChangeRequestStatus } | null; onClose: () => void }) {
  const [date, setDate] = useState(todayVn());
  const [note, setNote] = useState('');
  const run = useProjectMutation((a: { id: string; status: ChangeRequestStatus }) => projectApi.moveChangeRequest(a.id, a.status, date, note));
  useEffect(() => { if (value) { run.reset(); setDate(todayVn()); setNote(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [value?.cr.id, value?.status]);
  const approve = value?.status === 'Approved';
  const errors = fieldErrors(run.error);
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approve ? 'Khách đồng ý' : 'Khách từ chối'}: {value?.cr.code}</DialogTitle>
          <DialogDescription>{approve
            ? `${value?.cr.estimateManDays ? `Cộng ${value.cr.estimateManDays} ngày công vào ngân sách (nếu dự án có ngân sách). ` : ''}${value?.cr.billable ? 'Người phụ trách hợp đồng + kế toán được báo để lập phụ lục. ' : ''}Không hoàn tác được.`
            : 'Không hoàn tác được.'}</DialogDescription>
        </DialogHeader>
        <FormField id="cr-on" label="Ngày khách trả lời" type="date" max={todayVn()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.decidedOn} />
        <FormField id="cr-note" label="Ghi chú (email / biên bản…)" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter><Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button disabled={run.isPending} onClick={() => value && run.mutate({ id: value.cr.id, status: value.status },
            { onSuccess: () => { toast.success('Đã ghi nhận'); onClose(); }, onError: onErr })}>Xác nhận</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
