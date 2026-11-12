import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import type { IProjectAppendix } from '../../types/project.types';

/** Phụ lục — bảng phòng ban tham gia (chủ trì đứng đầu) + quyền của nhân viên phòng đó (do back-end tính). */
export function AppendixDepartments({ a, labels }: { a: IProjectAppendix; labels: (keys: string[]) => string[] }) {
  const access = labels(a.personas.find((p) => p.key === 'department')?.allowed ?? []);
  if (a.departments.length === 0) return <p className="text-sm text-muted-foreground">Chưa có phòng ban tham gia — chỉ thành viên (và HR / quyền Xem tài chính) thấy dự án.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table data-testid="appendix-departments">
        <TableHeader><TableRow><TableHead>Phòng ban</TableHead><TableHead className="w-28 text-right">Nhân viên</TableHead><TableHead>Quyền hạn của nhân viên phòng (không phải thành viên)</TableHead></TableRow></TableHeader>
        <TableBody>
          {a.departments.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">{d.name} {d.isLead && <StatusBadge tone="info">Chủ trì</StatusBadge>}</TableCell>
              <TableCell className="text-right tabular-nums">{d.employeeCount}</TableCell>
              <TableCell className="text-xs text-muted-foreground whitespace-normal">{access.join(' · ')}. Không tạo / sửa việc, không bình luận.</TableCell>
            </TableRow>))}
        </TableBody>
      </Table>
    </div>
  );
}
