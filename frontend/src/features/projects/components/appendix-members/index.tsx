import { BotBadge } from '@/components/common/bot-badge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import type { IProjectAppendix } from '../../types/project.types';

/** Phụ lục — bảng thành viên (người / bot) + vai trò + quyền hạn của vai trò (do back-end tính). */
export function AppendixMembers({ a, labels }: { a: IProjectAppendix; labels: (keys: string[]) => string[] }) {
  const byRole = { Manager: labels(a.personas.find((p) => p.key === 'manager')?.allowed ?? []), Member: labels(a.personas.find((p) => p.key === 'member')?.allowed ?? []) };
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table data-testid="appendix-members">
        <TableHeader><TableRow><TableHead>Họ tên</TableHead><TableHead>Mã NV</TableHead><TableHead>Phòng ban</TableHead><TableHead>Vai trò</TableHead><TableHead>Quyền hạn</TableHead></TableRow></TableHeader>
        <TableBody>
          {a.members.map((m) => (
            <TableRow key={m.employeeId}>
              <TableCell className="font-medium">{m.fullName}{m.isBot && <BotBadge className="ml-1" />}{!m.isActive && <span className="ml-1 text-xs text-muted-foreground">(đã nghỉ)</span>}</TableCell>
              <TableCell className="text-muted-foreground">{m.code ?? '—'}</TableCell>
              <TableCell>{m.departmentName ?? '—'}</TableCell>
              <TableCell>{m.role === 'Manager' ? <StatusBadge tone="info">Quản lý dự án</StatusBadge> : 'Thành viên'}</TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-normal">{byRole[m.role].join(' · ')}</TableCell>
            </TableRow>))}
        </TableBody>
      </Table>
    </div>
  );
}
