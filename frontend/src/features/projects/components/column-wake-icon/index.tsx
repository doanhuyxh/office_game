import { Bot } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/common/tooltip';
import { cn } from '@/utils/cn';
import type { IMember, ITaskColumn } from '../../types/project.types';

/**
 * Biểu tượng bot trên tiêu đề cột kanban (TEST-189) — chỉ hiện khi cột bật "Đánh thức bot theo dõi".
 * Tooltip: bot nào được gọi (hoặc mọi bot theo dõi việc) + có / chưa có hướng dẫn riêng. `onEdit` (người sửa được cột) → bấm mở hộp thoại sửa cột.
 */
export function ColumnWakeIcon({ column, members, onEdit }: { column: ITaskColumn; members: IMember[]; onEdit?: () => void }) {
  if (!column.wakeFollowers) return null;
  const names = (column.wakeBotIds ?? []).map((id) => members.find((m) => m.employeeId === id)?.fullName).filter((n): n is string => !!n);
  const who = names.length ? `Gọi bot: ${names.join(', ')}` : 'Gọi mọi bot theo dõi việc';
  const guide = column.hasGuide ? 'Có hướng dẫn riêng cho bot' : 'Chưa có hướng dẫn riêng — bot đọc hướng dẫn dự án';
  const label = `Đánh thức bot theo dõi. ${who}. ${guide}.`;
  const cls = cn('relative inline-grid size-6 shrink-0 place-items-center rounded-md text-info', onEdit && 'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring');
  const icon = <>
    <Bot className="size-3.5" aria-hidden />
    {column.hasGuide && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info ring-1 ring-background" aria-hidden />}
  </>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onEdit
          ? <button type="button" className={cls} aria-label={`${label} Bấm để sửa cột.`} onClick={onEdit} data-testid="col-wake-icon" data-has-guide={column.hasGuide ? '' : undefined}>{icon}</button>
          : <span tabIndex={0} className={cls} aria-label={label} data-testid="col-wake-icon" data-has-guide={column.hasGuide ? '' : undefined}>{icon}</span>}
      </TooltipTrigger>
      <TooltipContent className="max-w-64" data-testid="col-wake-tip">
        <p className="font-medium">Đánh thức bot theo dõi</p>
        <p>{who}</p>
        <p>{guide}</p>
        {onEdit && <p className="opacity-70">Bấm để sửa cột</p>}
      </TooltipContent>
    </Tooltip>
  );
}
