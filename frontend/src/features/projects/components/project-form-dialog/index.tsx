import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { departmentOptions, useDepartments, useEmployees } from '@/features/employees';
import { todayVn, useLines } from '@/features/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useSalesContractSearch } from '../../hooks/useProjects';
import type { IProject, IProjectRequest, ProjectKind, ProjectStatus } from '../../types/project.types';
import { PROJECT_KIND, PROJECT_STATUS } from '../../utils/labels';

/** Tạo / sửa dự án. Làm cho khách → gắn hợp đồng bán (tìm theo số / tên / khách). Mã không đổi sau khi tạo (dùng trong mã việc + số hiệu tài liệu). */
export function ProjectFormDialog({ open, project, onClose, onCreated }: { open: boolean; project?: IProject | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const employees = useEmployees().data ?? [];
  const departments = useDepartments().data ?? [];
  const lines = (useLines().data ?? []).filter((l) => l.isActive);
  const [f, setF] = useState<IProjectRequest>({ code: '', name: '', kind: 'Internal' });
  const [members, setMembers] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const search = useDebounce(q, 300);
  const contracts = useSalesContractSearch(search, open && f.kind === 'Client').data ?? [];
  const save = useProjectMutation((b: IProjectRequest) => projectApi.save(project?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    const p = project;
    setF(p ? { code: p.code, name: p.name, kind: p.kind, description: p.description ?? '', departmentId: p.departmentId, businessLineId: p.businessLineId, salesContractId: p.contract?.id ?? null,
      startOn: p.startOn ?? '', endOn: p.endOn ?? '', budgetManDays: p.budgetManDays, status: p.status }
      : { code: '', name: '', kind: 'Internal', description: '', departmentId: null, businessLineId: null, salesContractId: null, startOn: todayVn(), endOn: '', budgetManDays: null, status: 'Active' });
    setMembers([]); setQ('');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, project?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IProjectRequest>(k: K, v: IProjectRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const picked = project?.contract && f.salesContractId === project.contract.id ? project.contract : contracts.find((c) => c.id === f.salesContractId);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{project ? `Sửa dự án ${project.code}` : 'Dự án mới'}</DialogTitle>
          <DialogDescription>Mỗi dự án có kho tài liệu riêng cho thành viên. Người tạo là quản lý dự án.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, startOn: f.startOn || null, endOn: f.endOn || null, description: f.description || null, salesContractId: f.kind === 'Client' ? f.salesContractId : null,
            memberIds: project ? undefined : members }, {
            onSuccess: (id) => { toast.success('Đã lưu dự án'); onClose(); if (!project && typeof id === 'string') onCreated?.(id); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <div className="grid grid-cols-[9rem_1fr] gap-3">
            <FormField id="pj-code" label="Mã *" required maxLength={30} disabled={!!project} placeholder="APP-DATLICH" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} error={errors.code} />
            <FormField id="pj-name" label="Tên dự án *" required maxLength={200} value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField id="pj-kind" label="Loại" value={f.kind} onChange={(v) => set('kind', (v ?? 'Internal') as ProjectKind)}
              options={(Object.keys(PROJECT_KIND) as ProjectKind[]).map((k) => ({ value: k, label: PROJECT_KIND[k] }))} />
            {project ? <SelectField id="pj-status" label="Trạng thái" value={f.status ?? 'Active'} onChange={(v) => set('status', (v ?? 'Active') as ProjectStatus)}
              options={(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ value: s, label: PROJECT_STATUS[s].label }))} />
              : <SelectField id="pj-line" label="Mảng kinh doanh" allowEmpty value={f.businessLineId ?? null} onChange={(v) => set('businessLineId', v)} options={lines.map((l) => ({ value: l.id, label: l.name }))} />}
          </div>
          {f.kind === 'Client' && (
            <div className="grid gap-2 rounded-lg border p-3">
              <div className="text-sm font-medium">Hợp đồng bán *</div>
              {picked ? (
                <div className="flex items-center justify-between gap-2 text-sm"><span><b>{picked.code}</b> · {picked.title} · {picked.customerName}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => set('salesContractId', null)}>Đổi</Button></div>
              ) : (
                <>
                  <Input placeholder="Tìm số hợp đồng, tên, khách…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm hợp đồng" />
                  <div className="grid max-h-40 gap-1 overflow-y-auto">
                    {contracts.map((c) => <button key={c.id} type="button" className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => set('salesContractId', c.id)}>
                      <b>{c.code}</b> · {c.title} <span className="text-muted-foreground">— {c.customerName}</span></button>)}
                    {contracts.length === 0 && <p className="text-xs text-muted-foreground">Không có hợp đồng đang hiệu lực khớp</p>}
                  </div>
                </>
              )}
              {errors.salesContractId && <p className="text-xs text-destructive">{errors.salesContractId}</p>}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <FormField id="pj-start" label="Bắt đầu" type="date" value={f.startOn ?? ''} onChange={(e) => set('startOn', e.target.value)} />
            <FormField id="pj-end" label="Kết thúc dự kiến" type="date" value={f.endOn ?? ''} onChange={(e) => set('endOn', e.target.value)} error={errors.endOn} />
            <FormField id="pj-budget" label="Ngân sách (ngày công)" type="number" min={0} step="0.5" value={f.budgetManDays ?? ''}
              onChange={(e) => set('budgetManDays', e.target.value === '' ? null : Number(e.target.value))} error={errors.budgetManDays} />
          </div>
          <SelectField id="pj-dept" label="Phòng ban chủ trì" allowEmpty value={f.departmentId ?? null} onChange={(v) => set('departmentId', v)} options={departmentOptions(departments)} />
          <FormField id="pj-desc" label="Mô tả" maxLength={2000} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          {!project && (
            <div className="grid gap-2">
              <SelectField id="pj-mem" label="Thành viên ban đầu" allowEmpty emptyLabel="— Chọn để thêm —" value={null}
                onChange={(v) => v && !members.includes(v) && setMembers([...members, v])} options={employees.filter((e) => !members.includes(e.id)).map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})` }))} />
              {members.length > 0 && <div className="flex flex-wrap gap-1">{members.map((id) => (
                <button key={id} type="button" className="rounded-full bg-muted px-2 py-0.5 text-xs" onClick={() => setMembers(members.filter((x) => x !== id))}>
                  {employees.find((e) => e.id === id)?.fullName} ✕</button>))}</div>}
              {errors.memberIds && <p className="text-xs text-destructive">{errors.memberIds}</p>}
            </div>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
