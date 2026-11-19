import { ArrowRight } from 'lucide-react';
import type { ITaskColumn } from '../../types/project.types';
import { ColumnBadge } from '../column-badge';

/** Tóm tắt quy trình trạng thái của dự án (tab Hướng dẫn, TEST-183): các cột thành nhãn màu theo thứ tự + luật đi lần lượt / người duyệt. */
export function WorkflowSummary({ columns, sequential }: { columns: ITaskColumn[]; sequential: boolean }) {
  const approver = columns.filter((c) => c.approverOnly);
  return (
    <div className="grid gap-2" data-testid="workflow-summary">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quy trình</div>
      <div className="flex flex-wrap items-center gap-1">
        {columns.map((c, i) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            {i > 0 && sequential && <ArrowRight className="size-3 text-muted-foreground" />}
            <ColumnBadge name={c.name} color={c.color} />
          </span>
        ))}
      </div>
      <ul className="ml-4 list-disc space-y-0.5 text-xs text-muted-foreground">
        <li>{sequential ? 'Đi lần lượt từng trạng thái; chuyển lùi phải ghi lý do.' : 'Kéo thả tự do giữa các trạng thái.'}</li>
        {approver.length > 0 && <li>Chỉ quản lý dự án chuyển sang {approver.map((c) => `"${c.name}"`).join(', ')}.</li>}
        <li>Thành viên và BOT (qua MCP) đọc hướng dẫn này trước khi làm việc.</li>
      </ul>
    </div>
  );
}
