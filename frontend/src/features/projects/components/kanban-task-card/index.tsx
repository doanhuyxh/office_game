import type { DragEvent } from 'react';
import { CalendarDays, Hourglass, ImageIcon, Loader2, MessageSquare, User } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Checkbox } from '@/components/common/checkbox';
import { nameInitials } from '@/components/common/PersonAvatar';
import { fmtDate } from '@/features/finance';
import { cn } from '@/utils/cn';
import type { ITask } from '../../types/project.types';

/**
 * Thẻ việc trên kanban. Dòng đầu: mã + BOT (chừa chỗ bên phải cho ô tích nên không nhảy bố cục); tên việc; dòng cuối: người làm (chip chữ cái đầu),
 * "Chờ N việc", rồi hạn / ước lượng / bình luận / ảnh dồn phải. Chọn nhiều việc (thao tác hàng loạt): ô tích nhỏ nằm TRONG thẻ (hiện khi rê chuột,
 * khi đang có việc được chọn, hoặc trên màn cảm ứng); thẻ đã chọn có nền nhạt + vạch dọc primary ở mép trái. Ô tích là phần tử anh em của nút thẻ
 * (không lồng nút trong nút).
 */
export function KanbanTaskCard({ t, busy, dragging, flash, selected, selectable, selectionActive, draggable, onOpen, onDragStart, onDragEnd, onPick }: {
  t: ITask; busy: boolean; dragging: boolean; flash?: 'ok' | 'err'; selected: boolean; selectable: boolean;
  /** Đang có ít nhất một việc được chọn (mọi ô tích hiện rõ). */
  selectionActive: boolean; draggable: boolean;
  onOpen: () => void; onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onPick: (on: boolean, shift: boolean) => void;
}) {
  return (
    <div className="group/card relative w-full">
      <button type="button" draggable={draggable} disabled={busy} aria-busy={busy} onClick={onOpen} onDragStart={onDragStart} onDragEnd={onDragEnd}
        data-testid="task-card" data-selected={selected ? '' : undefined}
        className={cn('relative grid w-full gap-1.5 overflow-hidden rounded-lg border bg-card p-2 text-left text-sm shadow-xs transition-opacity hover:border-primary/50 disabled:cursor-progress',
          dragging && 'opacity-50', busy && 'opacity-80', selected && 'border-primary/50 bg-primary/5',
          flash === 'ok' && 'animate-in fade-in ring-2 ring-primary/60 duration-500', flash === 'err' && 'ring-2 ring-destructive')}>
        {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary" />}
        <span className={cn('flex min-w-0 items-center gap-1 text-xs text-muted-foreground', selectable && 'pr-6')}>
          <span className="truncate">{t.code}</span>
          {busy && <Loader2 className="size-3 shrink-0 animate-spin" aria-label="Đang lưu" />}
          {t.createdByBot && <BotBadge className="shrink-0" />}
        </span>
        <span className={cn('break-words', t.done ? 'text-muted-foreground line-through' : 'font-medium')}>{t.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {t.assigneeName
            ? <span className="inline-flex min-w-0 items-center gap-1" title={t.assigneeName}>
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[9px] font-semibold text-foreground">{nameInitials(t.assigneeName)}</span>
                <span className="truncate">{t.assigneeName}</span>
              </span>
            : <span className="inline-flex items-center gap-1 italic"><User className="size-3.5" aria-hidden />Chưa giao</span>}
          {!!t.waitingOn && !t.done && <span className="inline-flex items-center gap-0.5 rounded bg-warning/15 px-1 text-[10px] font-medium text-warning"
            title="Còn chờ việc khác chưa xong / chưa tới trạng thái cho việc sau bắt đầu" data-testid="task-waiting"><Hourglass className="size-3" aria-hidden />Chờ {t.waitingOn} việc</span>}
          <span className="ml-auto flex items-center gap-2">
            {t.dueOn && <span className={cn('inline-flex items-center gap-1', t.overdue && 'text-destructive')} title={t.overdue ? 'Quá hạn' : 'Hạn'}><CalendarDays className="size-3" aria-hidden />{fmtDate(t.dueOn)}</span>}
            {t.estimateDays != null && <span title="Ước lượng">{t.estimateDays}d</span>}
            {t.commentCount > 0 && <span className="inline-flex items-center gap-0.5" title="Bình luận"><MessageSquare className="size-3" aria-hidden />{t.commentCount}</span>}
            {t.mediaLinks.length > 0 && <span className="inline-flex items-center gap-0.5" title="Ảnh / video"><ImageIcon className="size-3" aria-hidden />{t.mediaLinks.length}</span>}
          </span>
        </span>
      </button>
      {selectable && <Checkbox checked={selected} aria-label={`Chọn ${t.code}`} data-testid="task-check"
        className={cn('absolute top-2.5 right-2.5 size-4 border-muted-foreground/40 bg-card dark:bg-card data-[state=checked]:bg-primary dark:data-[state=checked]:bg-primary',
          !selected && !selectionActive && 'opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100')}
        onCheckedChange={() => { /* xử lý ở onClick để biết phím Shift */ }}
        onClick={(e) => { e.stopPropagation(); onPick(!selected, e.shiftKey); }} />}
    </div>
  );
}
