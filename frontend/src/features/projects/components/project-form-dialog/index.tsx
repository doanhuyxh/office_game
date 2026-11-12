import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { departmentOptions, useDepartments, useEmployees } from '@/features/employees';
import { todayVn, useLines } from '@/features/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useSalesContractSearch } from '../../hooks/useProjects';
import type { IProject, IProjectRequest, ISalesContractRef, ProjectKind, ProjectStatus } from '../../types/project.types';
import { PROJECT_KIND, PROJECT_STATUS } from '../../utils/labels';
import { MarkdownEditor } from '../markdown-editor';

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3" data-testid={testId}>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Tạo / sửa dự án. Làm cho khách → gắn một hoặc nhiều hợp đồng bán (tìm theo số / tên / khách); một hợp đồng chỉ thuộc một dự án.
 * Mã không đổi sau khi tạo (dùng trong mã việc + số hiệu tài liệu). Quy trình "Đi lần lượt" (mặc định bật cho dự án mới)
 * + hướng dẫn làm việc (Markdown — người và BOT đọc qua MCP get_project).
 * Bố cục: header + footer cố định; từ `lg` 2 cột cuộn riêng — trái: thông tin chung / hợp đồng / thời gian / quy trình / thành viên, phải: chỉ mô tả + hướng dẫn.
 */
export function ProjectFormDialog({ open, project, workGuide, onClose, onCreated }: {
  open: boolean; project?: IProject | null; workGuide?: string | null; onClose: () => void; onCreated?: (id: string) => void;
}) {
  const employees = useEmployees().data ?? [];
  const departments = useDepartments().data ?? [];
  const lines = (useLines().data ?? []).filter((l) => l.isActive || l.id === project?.businessLineId);
  const [f, setF] = useState<IProjectRequest>({ code: '', name: '', kind: 'Internal' });
  const [members, setMembers] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ISalesContractRef[]>([]);
  const [preview, setPreview] = useState(false);
  const search = useDebounce(q, 300).trim();
  const contractQuery = useSalesContractSearch(search, open && f.kind === 'Client' && search.length > 0);
  const contracts = (contractQuery.data ?? []).filter((c) => !picked.some((x) => x.id === c.id));
  const save = useProjectMutation((b: IProjectRequest) => projectApi.save(project?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    const p = project;
    setF(p ? { code: p.code, name: p.name, kind: p.kind, description: p.description ?? '', departmentId: p.departmentId, businessLineId: p.businessLineId, salesContractIds: p.contracts.map((c) => c.id),
      startOn: p.startOn ?? '', endOn: p.endOn ?? '', budgetManDays: p.budgetManDays, status: p.status, sequential: p.sequential, workGuide: workGuide ?? '' }
      : { code: '', name: '', kind: 'Internal', description: '', departmentId: null, businessLineId: null, salesContractIds: [], startOn: todayVn(), endOn: '', budgetManDays: null, status: 'Active',
        sequential: true, workGuide: '' });
    setMembers([]); setQ(''); setPicked(p?.contracts ?? []); setPreview(!!workGuide?.trim());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, project?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IProjectRequest>(k: K, v: IProjectRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const pick = (next: ISalesContractRef[]) => { setPicked(next); set('salesContractIds', next.map((c) => c.id)); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-none flex-col gap-0 p-0 sm:max-w-5xl">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, startOn: f.startOn || null, endOn: f.endOn || null, description: f.description || null, salesContractIds: f.kind === 'Client' ? f.salesContractIds : [],
            memberIds: project ? undefined : members }, {
            onSuccess: (id) => { toast.success('Đã lưu dự án'); onClose(); if (!project && typeof id === 'string') onCreated?.(id); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <DialogHeader className="shrink-0 border-b py-4 pr-12 pl-6 text-left">
            <DialogTitle>{project ? `Sửa dự án ${project.code}` : 'Dự án mới'}</DialogTitle>
            <DialogDescription>Mỗi dự án có kho tài liệu riêng cho thành viên. Người tạo là quản lý dự án.</DialogDescription>
          </DialogHeader>
          {/* Mobile: 1 cột, cả thân cuộn chung; từ lg: trái = các ô thông tin, phải = mô tả + hướng dẫn, mỗi cột cuộn riêng */}
          <div className="grid min-h-0 flex-1 grid-cols-1 content-start overflow-y-auto lg:grid-cols-2 lg:content-stretch lg:overflow-hidden">
            <div className="grid min-w-0 grid-cols-1 content-start gap-6 px-6 py-5 lg:min-h-0 lg:overflow-y-auto" data-testid="pj-col-fields">
              <Section title="Thông tin chung">
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <FormField id="pj-code" label="Mã *" required maxLength={30} disabled={!!project} placeholder="APP-DATLICH" value={f.code}
                    onChange={(e) => set('code', e.target.value.toUpperCase())} error={errors.code} hint={project ? 'Không đổi sau khi tạo' : undefined} />
                  <FormField id="pj-name" label="Tên dự án *" required maxLength={200} value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
                </div>
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <SelectField id="pj-kind" label="Loại" value={f.kind} onChange={(v) => set('kind', (v ?? 'Internal') as ProjectKind)}
                    options={(Object.keys(PROJECT_KIND) as ProjectKind[]).map((k) => ({ value: k, label: PROJECT_KIND[k] }))} />
                  {project && <SelectField id="pj-status" label="Trạng thái" value={f.status ?? 'Active'} onChange={(v) => set('status', (v ?? 'Active') as ProjectStatus)}
                    options={(Object.keys(PROJECT_STATUS) as ProjectStatus[]).map((s) => ({ value: s, label: PROJECT_STATUS[s].label }))} />}
                  <SelectField id="pj-line" label="Mảng kinh doanh" allowEmpty value={f.businessLineId ?? null} onChange={(v) => set('businessLineId', v)}
                    options={lines.map((l) => ({ value: l.id, label: l.name }))} error={errors.businessLineId} />
                  <SelectField id="pj-dept" label="Phòng ban chủ trì" allowEmpty value={f.departmentId ?? null} onChange={(v) => set('departmentId', v)}
                    options={departmentOptions(departments)} error={errors.departmentId} />
                </div>
              </Section>
              {f.kind === 'Client' && (
                <Section title="Khách hàng & hợp đồng" hint="Hợp đồng bán * — một dự án có thể có nhiều hợp đồng, một hợp đồng chỉ thuộc một dự án." testId="pj-contracts">
                  {picked.length > 0 && <ul className="grid gap-1">
                    {picked.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2 rounded-md border px-2 py-1.5 text-sm" data-testid="picked-contract">
                        <span className="min-w-0"><b>{c.code}</b> · {c.title}<span className="block text-xs text-muted-foreground">{c.customerName}</span></span>
                        <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" aria-label={`Bỏ hợp đồng ${c.code}`}
                          onClick={() => pick(picked.filter((x) => x.id !== c.id))}><X /></Button>
                      </li>))}
                  </ul>}
                  <Input placeholder="Gõ số hợp đồng, tên, khách để thêm…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm hợp đồng"
                    onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} />
                  {search.length > 0 && (
                    <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-1" data-testid="contract-results">
                      {contracts.map((c) => (
                        <button key={c.id} type="button" className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted" onClick={() => pick([...picked, c])}>
                          <b>{c.code}</b> · {c.title} <span className="text-muted-foreground">— {c.customerName}</span></button>))}
                      {!contractQuery.isFetching && contracts.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">Không có hợp đồng đang hiệu lực khớp</p>}
                    </div>
                  )}
                  {errors.salesContractIds && <p className="text-xs text-destructive">{errors.salesContractIds}</p>}
                </Section>
              )}
              <Section title="Thời gian & ngân sách">
                <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                  <FormField id="pj-start" label="Bắt đầu" type="date" value={f.startOn ?? ''} onChange={(e) => set('startOn', e.target.value)} error={errors.startOn} />
                  <FormField id="pj-end" label="Kết thúc dự kiến" type="date" value={f.endOn ?? ''} onChange={(e) => set('endOn', e.target.value)} error={errors.endOn} />
                  <FormField id="pj-budget" label="Ngân sách (ngày công)" type="number" min={0} step="0.5" value={f.budgetManDays ?? ''}
                    onChange={(e) => set('budgetManDays', e.target.value === '' ? null : Number(e.target.value))} error={errors.budgetManDays} />
                </div>
              </Section>
              <Section title="Quy trình">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={!!f.sequential} onChange={(e) => set('sequential', e.target.checked)} data-testid="pj-sequential" />
                  <span><span className="font-medium">Đi lần lượt</span>
                    <span className="block text-xs text-muted-foreground">Việc chỉ tiến từng trạng thái một theo thứ tự cột; chuyển lùi phải ghi lý do. Trạng thái "Cần người duyệt" luôn chỉ quản lý dự án chuyển vào. Áp dụng cho cả người và BOT.</span></span>
                </label>
              </Section>
              {!project && (
                <Section title="Thành viên ban đầu" hint="Bạn là quản lý dự án; thêm thành viên khác sau ở tab Thành viên cũng được.">
                  <SearchSelectField id="pj-mem" label="Thêm thành viên" allowEmpty emptyLabel="— Chọn để thêm —" value={null}
                    onChange={(v) => v && !members.includes(v) && setMembers([...members, v])}
                    options={employees.filter((e) => !members.includes(e.id)).map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})`, hint: e.departmentName ?? undefined }))} />
                  {members.length > 0 && <div className="flex flex-wrap gap-1" data-testid="pj-members">{members.map((id) => (
                    <button key={id} type="button" className="rounded-full bg-muted px-2 py-0.5 text-xs" aria-label={`Bỏ ${employees.find((e) => e.id === id)?.fullName}`}
                      onClick={() => setMembers(members.filter((x) => x !== id))}>
                      {employees.find((e) => e.id === id)?.fullName} ✕</button>))}</div>}
                  {errors.memberIds && <p className="text-xs text-destructive">{errors.memberIds}</p>}
                </Section>
              )}
            </div>
            <div className="grid min-w-0 grid-cols-1 content-start gap-6 border-t px-6 py-5 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l" data-testid="pj-col-text">
              <Section title="Mô tả">
                <Textarea id="pj-desc" aria-label="Mô tả" rows={5} className="min-h-28" maxLength={2000} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)}
                  placeholder="Mục tiêu, phạm vi, khách hàng…" />
                {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
              </Section>
              <Section title="Hướng dẫn làm việc" hint="Thành viên và BOT đọc trước khi làm việc trong dự án (Markdown).">
                <MarkdownEditor id="pj-guide" label="Nội dung hướng dẫn" value={f.workGuide ?? ''} onChange={(v) => set('workGuide', v)}
                  preview={preview} onPreviewChange={setPreview} rows={16} minHeightClass="min-h-80" maxLength={20000} error={errors.workGuide} emptyText="Chưa có hướng dẫn."
                  placeholder={'## Định nghĩa "xong"\n- Có bình luận kết quả + link sản phẩm\n## Quy ước\n- Đặt tên nhánh theo mã việc…'} />
              </Section>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
