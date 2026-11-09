import { cn } from '@/utils/cn';
import type { IProjectProgress } from '../../types/project.types';

const SEGMENTS = [
  { key: 'done', label: 'Xong', className: 'bg-success' },
  { key: 'review', label: 'Chờ review', className: 'bg-warning' },
  { key: 'doing', label: 'Đang làm', className: 'bg-info' },
] as const;

/** Thanh việc xếp chồng Xong / Chờ review / Đang làm (phần còn lại = Cần làm) + % hoàn thành; vạch đen = % thời gian đã trôi. */
export function ProgressBar({ p, className }: { p: IProjectProgress; className?: string }) {
  const total = p.todo + p.doing + p.review + p.done;
  const title = [`Xong ${p.done}`, `Chờ review ${p.review}`, `Đang làm ${p.doing}`, `Cần làm ${p.todo}`].join(' · ')
    + (p.timeElapsedPercent != null ? ` — đã qua ${p.timeElapsedPercent}% thời gian` : '');
  return (
    <div className={cn('flex items-center gap-2', className)} title={title}>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        {total > 0 && <div className="flex h-full">
          {SEGMENTS.map((s) => p[s.key] > 0 && <div key={s.key} className={s.className} style={{ width: `${(100 * p[s.key]) / total}%` }} />)}
        </div>}
        {p.timeElapsedPercent != null && <div className="absolute top-0 h-full w-0.5 bg-foreground/70" style={{ left: `calc(${p.timeElapsedPercent}% - 1px)` }} />}
      </div>
      <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{p.percentDone != null ? `${p.percentDone}%` : '—'}</span>
    </div>
  );
}

export function ProgressLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {SEGMENTS.map((s) => <span key={s.key} className="flex items-center gap-1"><span className={cn('size-2 rounded-full', s.className)} />{s.label}</span>)}
      <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted ring-1 ring-border" />Cần làm</span>
      <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-foreground/70" />Thời gian đã trôi</span>
    </div>
  );
}
