import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { Label } from '@/components/common/label';
import { departmentOptions, useDepartments, useEmployees } from '@/features/employees';
import { todayVn, useLines } from '@/features/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useSalesContractSearch } from '../../hooks/useProjects';
import type { IProject, IProjectRequest, ISalesContractRef, ProjectKind, ProjectStatus } from '../../types/project.types';
import { PROJECT_KIND, PROJECT_STATUS } from '../../utils/labels';

/**
 * Tạo / sửa dự án. Làm cho khách → gắn một hoặc nhiều hợp đồng bán (tìm theo số / tên / khách); một hợp đồng chỉ thuộc một dự án.
 * Mã không đổi sau khi tạo (dùng trong mã việc + số hiệu tài liệu).
 * Quy trình "Xong cần duyệt" (mặc định bật cho dự án mới) + hướng dẫn làm việc (Markdown — người và BOT đọc qua MCP get_project).
 */
export function ProjectFormDialog({ open, project, workGuide, onClose, onCreated }: {
  open: boolean; project?: IProject | null; workGuide?: string | null; onClose: () => void; onCreated?: (id: string) => void;
}) {
  const employees = useEmployees().data ?? [];
  const departments = useDepartments().data ?? [];
  const lines = (useLines().data ?? []).filter((l) => l.isActive);
  const [f, setF] = useState<IProjectRequest>({ code: '', name: '', kind: 'Internal' });
  const [members, setMembers] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ISalesContractRef[]>([]);
  const search = useDebounce(q, 300);
  const contracts = useSalesContractSearch(search, open && f.kind === 'Client').data ?? [];
  const save = useProjectMutation((b: IProjectRequest) => projectApi.save(project?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    const p = project;
    setF(p ? { code: p.code, name: p.name, kind: p.kind, description: p.description ?? '', departmentId: p.departmentId, businessLineId: p.businessLineId, salesContractIds: p.contracts.map((c) => c.id),
      startOn: p.startOn ?? '', endOn: p.endOn ?? '', budgetManDays: p.budgetManDays, status: p.status, sequential: p.sequential, workGuide: workGuide ?? '' }
      : { code: '', name: '', kind: 'Internal', description: '', departmentId: null, businessLineId: null, salesContractIds: [], startOn: todayVn(), endOn: '', budgetManDays: null, status: 'Active',
        sequential: true, workGuide: '' });
    setMembers([]); setQ(''); setPicked(p?.contracts ?? []);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, project?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IProjectRequest>(k: K, v: IProjectRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const pick = (next: ISalesContractRef[]) => { setPicked(next); set('salesContractIds', next.map((c) => c.id)); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{project ? `Sửa dự án ${project.code}` : 'Dự án mới'}</DialogTitle>
          <DialogDescription>Mỗi dự án có kho tài liệu riêng cho thành viên. Người tạo là quản lý dự án.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, startOn: f.startOn || null, endOn: f.endOn || null, description: f.description || null, salesContractIds: f.kind === 'Client' ? f.salesContractIds : [],
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
              <div className="text-sm font-medium">Hợp đồng bán * <span className="font-normal text-muted-foreground">— một dự án có thể có nhiều hợp đồng</span></div>
              {picked.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-sm" data-testid="picked-contract"><span><b>{c.code}</b> · {c.title} · {c.customerName}</span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => pick(picked.filter((x) => x.id !== c.id))}>Bỏ</Button></div>
              ))}
              <Input placeholder="Tìm số hợp đồng, tên, khách để thêm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm hợp đồng" />
              <div className="grid max-h-40 gap-1 overflow-y-auto">
                {contracts.filter((c) => !picked.some((x) => x.id === c.id)).map((c) => (
                  <button key={c.id} type="button" className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => pick([...picked, c])}>
                    <b>{c.code}</b> · {c.title} <span className="text-muted-foreground">— {c.customerName}</span></button>))}
                {contracts.length === 0 && <p className="text-xs text-muted-foreground">Không có hợp đồng đang hiệu lực khớp</p>}
              </div>
              {errors.salesContractIds && <p className="text-xs text-destructive">{errors.salesContractIds}</p>}
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
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={!!f.sequential} onChange={(e) => set('sequential', e.target.checked)} data-testid="pj-sequential" />
            <span><span className="font-medium">Đi lần lượt</span>
              <span className="block text-xs text-muted-foreground">Việc chỉ tiến từng trạng thái một theo thứ tự cột; chuyển lùi phải ghi lý do. Trạng thái "Cần người duyệt" luôn chỉ quản lý dự án chuyển vào. Áp dụng cho cả người và BOT.</span></span>
          </label>
          <div className="grid gap-2">
            <Label htmlFor="pj-guide">Hướng dẫn làm việc <span className="font-normal text-muted-foreground">(Markdown — thành viên và BOT đọc trước khi làm)</span></Label>
            <Textarea id="pj-guide" rows={6} maxLength={20000} className="font-mono text-xs" value={f.workGuide ?? ''} onChange={(e) => set('workGuide', e.target.value)}
              placeholder={'## Định nghĩa "xong"\n- Có bình luận kết quả + link sản phẩm\n## Quy ước\n- Đặt tên nhánh theo mã việc…'} />
            {errors.workGuide && <p className="text-xs text-destructive">{errors.workGuide}</p>}
          </div>
          {!project && (
            <div className="grid gap-2">
              <SearchSelectField id="pj-mem" label="Thành viên ban đầu" allowEmpty emptyLabel="— Chọn để thêm —" value={null}
                onChange={(v) => v && !members.includes(v) && setMembers([...members, v])}
                options={employees.filter((e) => !members.includes(e.id)).map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})`, hint: e.departmentName ?? undefined }))} />
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
