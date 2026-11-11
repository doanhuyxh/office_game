import { cn } from '@/utils/cn';

/** Nhãn trạng thái (cột) của việc: chấm màu của cột + tên. */
export function ColumnBadge({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', className)} data-testid="column-badge">
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />{name}
    </span>
  );
}
