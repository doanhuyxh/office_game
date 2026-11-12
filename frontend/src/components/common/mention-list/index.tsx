import { BotBadge } from '@/components/common/bot-badge';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { cn } from '@/utils/cn';

export interface IMentionOption { key: string; name: string; hint?: string | null; avatarUrl?: string | null; isBot?: boolean }

/**
 * Danh sách gợi ý @nhắc (Bảng tin, bình luận việc). Bấm chuột chọn (onMouseDown + preventDefault để ô nhập không mất focus);
 * bàn phím do `useMentionNav` ở ô nhập điều khiển. Vị trí (absolute…) truyền qua `className`.
 */
export function MentionList({ options, active, onPick, onHover, className }: {
  options: IMentionOption[]; active: number; onPick: (o: IMentionOption) => void; onHover?: (i: number) => void; className?: string;
}) {
  if (options.length === 0) return null;
  return (
    <ul className={cn('z-20 w-72 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md', className)} role="listbox" data-testid="mention-list">
      {options.map((o, i) => (
        <li key={o.key} role="option" aria-selected={i === active}>
          <button type="button" className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent', i === active && 'bg-accent')}
            onMouseDown={(e) => { e.preventDefault(); onPick(o); }} onMouseEnter={() => onHover?.(i)}>
            {o.avatarUrl !== undefined && <PersonAvatar name={o.name} url={o.avatarUrl} className="size-6" fallbackClassName="text-[10px]" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{o.name}{o.isBot && <BotBadge className="ml-1" />}</span>
              {o.hint && <span className="truncate text-xs text-muted-foreground">{o.hint}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
