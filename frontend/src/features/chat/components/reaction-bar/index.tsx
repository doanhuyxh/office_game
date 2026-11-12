import { cn } from '@/utils/cn';
import type { IReaction } from '../../types/chat.types';

/** Các emoji đã thả dưới bong bóng tin: số người, emoji của tôi được tô; bấm = thả / gỡ. */
export function ReactionBar({ reactions, meId, mine, onToggle }: {
  reactions: IReaction[];
  meId: string | undefined;
  mine: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (reactions.length === 0) return null;
  return (
    <div className={cn('mt-1 flex flex-wrap gap-1', mine && 'justify-end')} data-testid="chat-reactions">
      {reactions.map((r) => {
        const reacted = !!meId && r.userIds.includes(meId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle(r.emoji)}
            aria-pressed={reacted}
            title={reacted ? 'Bấm để gỡ cảm xúc' : 'Bấm để thả cùng cảm xúc'}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-xs leading-none hover:bg-accent',
              reacted && 'border-primary bg-primary/10',
            )}
            data-testid="chat-reaction"
          >
            <span className="text-sm">{r.emoji}</span>
            <span className="tabular-nums text-muted-foreground">{r.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}
