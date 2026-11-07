import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { useMe } from '@/features/auth';
import { useDepartments, useEmployees } from '@/features/employees';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { documentApi } from '../../api/document.api';
import { useDocMutation, useProjects } from '../../hooks/useDocuments';
import type { IProject, ISpaceRef, ProjectRole, ProjectStatus } from '../../types/document.types';

/** Danh sách dự án (HR: tất cả; người khác: dự án mình tham gia). Quản lý / HR tạo dự án; quản lý dự án sửa + đổi thành viên. */
/** Quản lý / HR / admin được tạo dự án (nút "Dự án mới" đặt trên hàng tab — DocumentsPage). */
export const useCanCreateProject = () => !!useMe().data?.roles.some((r) => r === 'admin' || r === 'hr' || r === 'manager');

export function ProjectsTab({ onOpenSpace, creating, onCreated }: { onOpenSpace: (s: ISpaceRef) => void; creating: boolean; onCreated: () => void }) {
  const projects = useProjects();
  const canCreate = useCanCreateProject();
  const [editing, setEditing] = useState<IProject | 'new' | null>(null);
  useEffect(() => { if (creating) { setEditing('new'); onCreated(); } }, [creating, onCreated]);
  const [members, setMembers] = useState<IProject | null>(null);
  const list = projects.data ?? [];

  return (
    <div className="grid gap-3">
      {projects.isLoading ? <Spinner /> : list.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Chưa có dự án nào{canCreate ? '' : ' bạn tham gia'}.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <div key={p.id} className="grid content-start gap-2 rounded-xl border bg-card p-4" data-testid="project-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.code}{p.departmentName ? ` · ${p.departmentName}` : ''}</div>
                </div>
                <StatusBadge tone={p.status === 'Active' ? 'success' : 'muted'}>{p.status === 'Active' ? 'Đang chạy' : 'Đã đóng'}</StatusBadge>
              </div>
              {p.description && <p className="line-clamp-3 text-sm text-muted-foreground">{p.description}</p>}
              <div className="text-xs text-muted-foreground">
                {p.members.length} thành viên · {p.assetCount} tài liệu{p.myRole ? ` · bạn là ${p.myRole === 'Manager' ? 'quản lý' : 'thành viên'}` : ''}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => onOpenSpace({ kind: 'Project', id: p.id })}><FolderOpen /> Mở kho</Button>
                <Button size="sm" variant="outline" onClick={() => setMembers(p)}><Users /> Thành viên</Button>
                {p.canManage && <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Sửa</Button>}
              </div>
            </div>
          ))}
        </div>
      )}
      <ProjectDialog project={editing} onClose={() => setEditing(null)} />
      <MembersDialog project={members ? list.find((p) => p.id === members.id) ?? members : null} onClose={() => setMembers(null)} />
    </div>
  );
}

function ProjectDialog({ project, onClose }: { project: IProject | 'new' | null; onClose: () => void }) {
  const isNew = project === 'new';
  const p = isNew ? null : project;
  const departments = useDepartments();
  const [form, setForm] = useState({ code: '', name: '', description: '', departmentId: null as string | null, status: 'Active' as ProjectStatus });
  const save = useDocMutation((): Promise<unknown> => isNew
    ? documentApi.createProject({ code: form.code.trim(), name: form.name.trim(), description: form.description.trim() || null, departmentId: form.departmentId, memberIds: [] })
    : documentApi.updateProject(p!.id, { name: form.name.trim(), description: form.description.trim() || null, departmentId: form.departmentId, status: form.status }));
  const remove = useDocMutation(() => documentApi.deleteProject(p!.id));
  const errors = fieldErrors(save.error);
  useEffect(() => {
    if (!project) return;
    setForm(p ? { code: p.code, name: p.name, description: p.description ?? '', departmentId: p.departmentId, status: p.status }
      : { code: '', name: '', description: '', departmentId: null, status: 'Active' });
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, {
      onSuccess: () => { toast.success(isNew ? 'Đã tạo dự án — bạn là quản lý dự án' : 'Đã lưu dự án'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Dự án mới' : `Sửa dự án ${p?.code}`}</DialogTitle>
          <DialogDescription>Mỗi dự án có kho tài liệu riêng, chỉ thành viên (và HR) vào được. Dự án đã đóng: kho chỉ đọc.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <FormField id="pj-code" label="Mã *" maxLength={30} value={form.code} disabled={!isNew} placeholder="VD: APP2026"
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} error={errors.code} />
            <FormField id="pj-name" label="Tên dự án *" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          </div>
          <SelectField id="pj-dept" label="Phòng ban chủ trì" value={form.departmentId} allowEmpty onChange={(v) => setForm({ ...form, departmentId: v })}
            options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))} error={errors.departmentId} />
          <div className="grid gap-2">
            <Label htmlFor="pj-desc">Mô tả</Label>
            <Textarea id="pj-desc" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          {!isNew && (
            <SelectField id="pj-status" label="Trạng thái" value={form.status} onChange={(v) => v && setForm({ ...form, status: v as ProjectStatus })}
              options={[{ value: 'Active', label: 'Đang chạy' }, { value: 'Closed', label: 'Đã đóng (kho chỉ đọc)' }]} />
          )}
          <DialogFooter className="gap-2">
            {!isNew && p?.assetCount === 0 && (
              <Button type="button" variant="ghost" className="text-destructive sm:me-auto" disabled={remove.isPending}
                onClick={() => remove.mutate(undefined, { onSuccess: () => { toast.success('Đã xoá dự án'); onClose(); }, onError: (e) => toast.error(errorMessage(e)) })}>
                Xoá dự án
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending || !form.name.trim() || !form.code.trim()}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog({ project, onClose }: { project: IProject | null; onClose: () => void }) {
  const employees = useEmployees();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<ProjectRole>('Member');
  const add = useDocMutation(() => documentApi.addMembers(project!.id, [...picked], role));
  const remove = useDocMutation((employeeId: string) => documentApi.removeMember(project!.id, project!.members.find((m) => m.employeeId === employeeId)!));
  useEffect(() => { setSearch(''); setPicked(new Set()); setRole('Member'); }, [project?.id]);
  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inProject = new Set(project?.members.map((m) => m.employeeId));
    return (employees.data ?? []).filter((e) => e.status !== 'Resigned' && !inProject.has(e.id))
      .filter((e) => !q || e.fullName.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.departmentName ?? '').toLowerCase().includes(q));
  }, [employees.data, search, project?.members]);
  if (!project) return null;
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thành viên · {project.name}</DialogTitle>
          <DialogDescription>Quản lý dự án được sửa dự án, đổi thành viên và quản lý kho tài liệu dự án.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-lg border text-sm">
          {project.members.map((m) => (
            <li key={m.employeeId} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{m.fullName} <span className="text-xs text-muted-foreground">{m.code}{!m.isActive ? ' · đã nghỉ' : ''}</span></span>
              <StatusBadge tone={m.role === 'Manager' ? 'primary' : 'muted'}>{m.role === 'Manager' ? 'Quản lý' : 'Thành viên'}</StatusBadge>
              {project.canManage && (
                <Button size="icon-sm" variant="ghost" aria-label={`Bỏ ${m.fullName}`} disabled={remove.isPending}
                  onClick={() => remove.mutate(m.employeeId, { onError: (e) => toast.error(errorMessage(e)) })}><X /></Button>
              )}
            </li>
          ))}
        </ul>
        {project.canManage && project.status === 'Active' && (
          <div className="grid gap-2">
            <Label htmlFor="pm-search">Thêm thành viên {picked.size > 0 && <span className="text-muted-foreground">({picked.size} người)</span>}</Label>
            <Input id="pm-search" placeholder="Tìm tên, mã, phòng ban…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-48 overflow-y-auto rounded-md border p-1">
              {candidates.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={picked.has(e.id)} onCheckedChange={(c) => toggle(e.id, c === true)} />
                  <span>{e.fullName}</span><span className="text-xs text-muted-foreground">{e.code}{e.departmentName ? ` · ${e.departmentName}` : ''}</span>
                </label>
              ))}
              {candidates.length === 0 && <p className="p-2 text-sm text-muted-foreground">Không có ai phù hợp.</p>}
            </div>
            <div className="flex items-end gap-2">
              <div className="w-44"><SelectField id="pm-role" label="Vai trò" value={role} onChange={(v) => v && setRole(v as ProjectRole)}
                options={[{ value: 'Member', label: 'Thành viên' }, { value: 'Manager', label: 'Quản lý dự án' }]} /></div>
              <Button disabled={!picked.size || add.isPending}
                onClick={() => add.mutate(undefined, { onSuccess: () => { toast.success(`Đã thêm ${picked.size} người`); setPicked(new Set()); }, onError: (e) => toast.error(errorMessage(e)) })}>
                Thêm
              </Button>
            </div>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onClose}>Đóng</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
