import { cn } from '@/utils/cn';
import type { IProjectProgress } from '../../types/project.types';

/** Thanh việc xong (cột hoàn thành) / tổng việc + % hoàn thành; vạch đen = % thời gian đã trôi. Trạng thái là cột tự do của từng dự án nên chỉ chia xong / chưa xong. */
export function ProgressBar({ p, className }: { p: IProjectProgress; className?: string }) {
  const total = p.total;
  const title = `Xong ${p.done} · Chưa xong ${p.total - p.done}` + (p.timeElapsedPercent != null ? ` — đã qua ${p.timeElapsedPercent}% thời gian` : '');
  return (
    <div className={cn('flex items-center gap-2', className)} title={title}>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        {total > 0 && <div className="flex h-full">
          {p.done > 0 && <div className="bg-success" style={{ width: `${(100 * p.done) / total}%` }} />}
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
      <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-success" />Xong</span>
      <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted ring-1 ring-border" />Chưa xong</span>
      <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-foreground/70" />Thời gian đã trôi</span>
    </div>
  );
}
