import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { useEmployees } from '@/features/employees';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation } from '../../hooks/useProjects';
import type { IProjectDetail, MemberRole } from '../../types/project.types';

/** Thành viên + vai trò. Thành viên vào được kho tài liệu dự án; quản lý dự án quản lý kho, mốc, phân bổ. Luôn còn ≥ 1 quản lý. */
export function MembersPanel({ d }: { d: IProjectDetail }) {
  const p = d.project;
  const employees = useEmployees().data ?? [];
  const [role, setRole] = useState<MemberRole>('Member');
  const add = useProjectMutation((ids: string[]) => projectApi.addMembers(p.id, ids, role));
  const change = useProjectMutation((a: { id: string; role: MemberRole }) => projectApi.changeRole(p.id, a.id, a.role));
  const remove = useProjectMutation((id: string) => projectApi.removeMember(p.id, id));
  const onErr = (err: unknown) => toast.error(errorMessage(err));
  const memberIds = new Set(d.members.map((m) => m.employeeId));
  return (
    <div className="grid gap-3">
      {p.canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-72"><SelectField id="mb-add" label="Thêm thành viên" allowEmpty emptyLabel="— Chọn người —" value={null}
            onChange={(v) => v && add.mutate([v], { onSuccess: () => toast.success('Đã thêm'), onError: onErr })}
            options={employees.filter((e) => !memberIds.has(e.id)).map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})` }))} /></div>
          <div className="w-40"><SelectField id="mb-role" label="Vai trò khi thêm" value={role} onChange={(v) => setRole((v ?? 'Member') as MemberRole)}
            options={[{ value: 'Member', label: 'Thành viên' }, { value: 'Manager', label: 'Quản lý dự án' }]} /></div>
        </div>
      )}
      <div className="grid gap-2">
        {d.members.map((m) => (
          <div key={m.employeeId} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-sm" data-testid="member-row">
            <span><span className="font-medium">{m.fullName}</span> <span className="text-muted-foreground">{m.code}</span>{!m.isActive && <StatusBadge tone="muted" className="ml-2">Đã nghỉ</StatusBadge>}</span>
            {p.canManage ? (
              <span className="flex items-center gap-1">
                <select aria-label={`Vai trò ${m.fullName}`} className="rounded-md border bg-background px-2 py-1 text-sm" value={m.role}
                  onChange={(e) => change.mutate({ id: m.employeeId, role: e.target.value as MemberRole }, { onError: onErr })}>
                  <option value="Member">Thành viên</option><option value="Manager">Quản lý dự án</option>
                </select>
                <Button size="icon" variant="ghost" aria-label={`Bỏ ${m.fullName}`} onClick={() => confirm(`Bỏ ${m.fullName} khỏi dự án?`) && remove.mutate(m.employeeId, { onError: onErr })}><Trash2 /></Button>
              </span>
            ) : <StatusBadge tone={m.role === 'Manager' ? 'primary' : 'muted'}>{m.role === 'Manager' ? 'Quản lý dự án' : 'Thành viên'}</StatusBadge>}
          </div>
        ))}
      </div>
    </div>
  );
}
