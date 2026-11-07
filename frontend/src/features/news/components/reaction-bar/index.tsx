import { useState } from 'react';
import { ThumbsUp } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/common/dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { cn } from '@/utils/cn';
import { useReactors } from '../../hooks/useNews';
import type { ReactionType } from '../../types/news.types';
import { REACTIONS, reactionOf } from '../../utils/labels';

/** Nút "Thích" + bảng 6 cảm xúc hiện khi rê chuột / giữ (như Facebook). Bấm lại cảm xúc đang chọn = gỡ. */
export function ReactionButton({ mine, onReact, compact, disabled }: { mine: ReactionType | null; onReact: (t: ReactionType | null) => void; compact?: boolean; disabled?: boolean }) {
  const cur = mine ? reactionOf(mine) : null;
  return (
    <div className="group/react relative">
      <button type="button" disabled={disabled} data-testid="react-button"
        className={cn('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50', compact && 'px-1.5 py-0.5 text-xs', cur ? cur.className : 'text-muted-foreground')}
        onClick={() => onReact(mine ? null : 'Like')}>
        {cur ? <span className="text-base leading-none">{cur.emoji}</span> : <ThumbsUp className="size-4" />}
        {cur ? cur.label : 'Thích'}
      </button>
      <div className="absolute bottom-full left-0 z-20 hidden pb-1 group-focus-within/react:flex group-hover/react:flex">
        <div className="flex gap-0.5 rounded-full border bg-popover p-1 shadow-lg" role="menu">
          {REACTIONS.map((r) => (
            <button key={r.type} type="button" role="menuitem" title={r.label} aria-label={r.label} data-testid={`react-${r.type}`}
              className="rounded-full p-1 text-2xl leading-none transition-transform hover:scale-125" onClick={() => onReact(mine === r.type ? null : r.type)}>
              {r.emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "👍❤️ 12" — bấm để xem ai đã thả. */
export function ReactionSummaryLine({ kind, id, total, counts }: { kind: 'posts' | 'comments'; id: string; total: number; counts?: Partial<Record<ReactionType, number>> }) {
  const [open, setOpen] = useState(false);
  if (total <= 0) return null;
  const top = REACTIONS.filter((r) => (counts?.[r.type] ?? 0) > 0).sort((a, b) => (counts![b.type] ?? 0) - (counts![a.type] ?? 0)).slice(0, 3);
  return (
    <>
      <button type="button" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline" onClick={() => setOpen(true)} data-testid="reaction-count">
        <span className="flex -space-x-1">{top.map((r) => <span key={r.type} className="rounded-full bg-background text-sm leading-none">{r.emoji}</span>)}</span>
        {total}
      </button>
      {open && <ReactorsDialog kind={kind} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReactorsDialog({ kind, id, onClose }: { kind: 'posts' | 'comments'; id: string; onClose: () => void }) {
  const { data, isLoading } = useReactors(kind, id, true);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Cảm xúc</DialogTitle>
        <DialogDescription className="sr-only">Danh sách người đã thả cảm xúc</DialogDescription>
        {isLoading ? <Spinner /> : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {(data ?? []).map((r) => (
              <li key={r.userId} className="flex items-center justify-between py-2 text-sm"><span>{r.name}</span><span className="text-lg">{reactionOf(r.type).emoji}</span></li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
