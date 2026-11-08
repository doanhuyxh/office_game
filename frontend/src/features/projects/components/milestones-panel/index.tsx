import { confirmDialog } from '@/components/common/confirm-dialog';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { fmtDate, todayVn } from '@/features/finance';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useInstallments, useProjectMutation } from '../../hooks/useProjects';
import type { IMilestone, IMilestoneRequest, IProjectDetail, ISalesContractRef } from '../../types/project.types';

const onErr = (err: unknown) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err));

/** Mốc nghiệm thu. Dự án làm cho khách: gắn đợt thu của hợp đồng → nghiệm thu xong thì đợt thu đến hạn (kế toán + người phụ trách HĐ được báo). */
export function MilestonesPanel({ d }: { d: IProjectDetail }) {
  const p = d.project;
  const [edit, setEdit] = useState<IMilestone | null | undefined>(undefined);
  const [accepting, setAccepting] = useState<IMilestone | null>(null);
  const remove = useProjectMutation(projectApi.deleteMilestone);
  const canEdit = p.canManage && p.status === 'Active';
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{p.contracts.length ? `Gắn đợt thu của HĐ ${p.contracts.map((c) => c.code).join(', ')}: nghiệm thu mốc → đợt thu đến hạn, kế toán được báo.` : 'Dự án nội bộ — mốc chỉ để theo dõi tiến độ.'}</p>
        {canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(null)}><Plus /> Thêm mốc</Button>}
      </div>
      {d.milestones.length === 0 && <p className="text-sm text-muted-foreground">Chưa có mốc.</p>}
      {d.milestones.map((m) => (
        <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3" data-testid="milestone-row">
          <div className="grid gap-0.5 text-sm">
            <div className="flex items-center gap-2 font-medium">{m.title}
              {m.status === 'Accepted' ? <StatusBadge tone="success">Đã nghiệm thu {fmtDate(m.acceptedOn)}</StatusBadge> : <StatusBadge tone="muted">Chưa nghiệm thu</StatusBadge>}</div>
            <div className="text-xs text-muted-foreground">{m.dueOn && `Dự kiến ${fmtDate(m.dueOn)} · `}{m.tasksDone}/{m.tasksOpen + m.tasksDone} việc xong
              {m.installmentTitle && ` · Đợt thu: ${m.installmentTitle}`}{m.acceptedByName && ` · ${m.acceptedByName}`}</div>
            {m.note && <div className="text-xs text-muted-foreground">{m.note}</div>}
          </div>
          {canEdit && m.status === 'Open' && <div className="flex gap-1">
            <Button size="sm" onClick={() => setAccepting(m)}><CheckCircle2 /> Nghiệm thu</Button>
            <Button size="icon" variant="ghost" aria-label="Sửa mốc" onClick={() => setEdit(m)}><Pencil /></Button>
            <Button size="icon" variant="ghost" aria-label="Xoá mốc" onClick={async () => await confirmDialog({ title: `Xoá mốc "${m.title}"?`, confirmText: 'Xoá', destructive: true }) && remove.mutate(m.id, { onError: onErr })}><Trash2 /></Button>
          </div>}
        </div>
      ))}
      <MilestoneDialog projectId={p.id} contracts={p.contracts} milestone={edit} used={d.milestones.filter((m) => m.installmentId).map((m) => m.installmentId!)} onClose={() => setEdit(undefined)} />
      <AcceptDialog milestone={accepting} onClose={() => setAccepting(null)} />
    </div>
  );
}

function MilestoneDialog({ projectId, contracts, milestone, used, onClose }: { projectId: string; contracts: ISalesContractRef[]; milestone: IMilestone | null | undefined; used: string[]; onClose: () => void }) {
  const open = milestone !== undefined;
  const code = (id: string) => contracts.find((c) => c.id === id)?.code;
  const installments = (useInstallments(open && contracts.length ? projectId : null).data ?? []).filter((i) => !i.cancelled && (!used.includes(i.id) || i.id === milestone?.installmentId));
  const [f, setF] = useState<IMilestoneRequest>({ title: '' });
  const save = useProjectMutation((b: IMilestoneRequest): Promise<unknown> => (milestone ? projectApi.updateMilestone(milestone.id, b) : projectApi.addMilestone(projectId, b)));
  useEffect(() => { if (open) { save.reset(); setF(milestone ? { title: milestone.title, dueOn: milestone.dueOn ?? '', installmentId: milestone.installmentId, note: milestone.note ?? '' } : { title: '', dueOn: '', installmentId: null, note: '' }); }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, milestone?.id]);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{milestone ? 'Sửa mốc' : 'Thêm mốc nghiệm thu'}</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate({ ...f, dueOn: f.dueOn || null, note: f.note || null }, { onSuccess: () => { toast.success('Đã lưu mốc'); onClose(); }, onError: onErr }); }}>
          <FormField id="ms-title" label="Tên mốc *" required autoFocus maxLength={200} placeholder="Bàn giao MVP" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errors.title} />
          <FormField id="ms-due" label="Ngày dự kiến" type="date" value={f.dueOn ?? ''} onChange={(e) => setF({ ...f, dueOn: e.target.value })} />
          {contracts.length > 0 && <SelectField id="ms-inst" label="Đợt thu gắn với mốc" allowEmpty emptyLabel="— Không gắn —" value={f.installmentId ?? null} onChange={(v) => setF({ ...f, installmentId: v })}
            options={installments.map((i) => ({ value: i.id, label: `${contracts.length > 1 ? `HĐ ${code(i.contractId)} · ` : ''}${i.title} (hạn ${fmtDate(i.dueOn)})` }))} error={errors.installmentId} />}
          <FormField id="ms-note" label="Ghi chú" maxLength={1000} value={f.note ?? ''} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AcceptDialog({ milestone, onClose }: { milestone: IMilestone | null; onClose: () => void }) {
  const [date, setDate] = useState(todayVn());
  const [note, setNote] = useState('');
  const run = useProjectMutation((a: { id: string }) => projectApi.acceptMilestone(a.id, date, note || null));
  useEffect(() => { if (milestone) { run.reset(); setDate(todayVn()); setNote(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [milestone?.id]);
  const errors = fieldErrors(run.error);
  return (
    <Dialog open={!!milestone} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nghiệm thu: {milestone?.title}</DialogTitle>
          <DialogDescription>{milestone?.installmentTitle ? `Đợt thu "${milestone.installmentTitle}" sẽ đến hạn từ ngày nghiệm thu; kế toán được báo.` : 'Ghi nhận khách đã nghiệm thu mốc này.'} Không hoàn tác được.</DialogDescription>
        </DialogHeader>
        <FormField id="ac-date" label="Ngày nghiệm thu *" type="date" max={todayVn()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.acceptedOn} />
        <FormField id="ac-note" label="Ghi chú (biên bản…)" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter><Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button disabled={run.isPending || !date} onClick={() => milestone && run.mutate({ id: milestone.id }, { onSuccess: () => { toast.success('Đã nghiệm thu'); onClose(); }, onError: onErr })}>Xác nhận nghiệm thu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
