import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate } from '@/features/finance';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { useProjectList } from '../../hooks/useProjects';
import type { ProjectHealth } from '../../types/project.types';
import { PROJECT_HEALTH } from '../../utils/labels';
import { ProgressBar, ProgressLegend } from '../progress-bar';

/** Tổng quan tiến độ mọi dự án đang chạy mà tôi xem được: ô tóm tắt theo tình trạng + bảng (trễ / rủi ro lên đầu). */
export function ProjectsOverview() {
  const { data = [], isLoading, error } = useProjectList(false);
  const [filter, setFilter] = useState<ProjectHealth | null>(null);
  const navigate = useNavigate();
  if (isLoading) return <Spinner />;
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const active = data.filter((p) => p.status === 'Active')
    .sort((a, b) => PROJECT_HEALTH[a.progress.health ?? 'OnTrack'].rank - PROJECT_HEALTH[b.progress.health ?? 'OnTrack'].rank
      || b.progress.overdue - a.progress.overdue || a.name.localeCompare(b.name, 'vi'));
  const count = (h: ProjectHealth) => active.filter((p) => p.progress.health === h).length;
  const shown = filter ? active.filter((p) => p.progress.health === filter) : active;
  const overdueTasks = active.reduce((t, p) => t + p.progress.overdue, 0);
  const tiles: { key: ProjectHealth | null; label: string; value: number; tone: string }[] = [
    { key: null, label: 'Đang chạy', value: active.length, tone: '' },
    { key: 'OnTrack', label: PROJECT_HEALTH.OnTrack.label, value: count('OnTrack'), tone: 'text-success' },
    { key: 'AtRisk', label: PROJECT_HEALTH.AtRisk.label, value: count('AtRisk'), tone: 'text-warning' },
    { key: 'Late', label: PROJECT_HEALTH.Late.label, value: count('Late'), tone: 'text-destructive' },
  ];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5 @min-[140rem]/content:grid-cols-[repeat(5,minmax(0,28rem))]">
        {tiles.map((t) => (
          <button key={t.label} type="button" onClick={() => setFilter(t.key)} aria-pressed={filter === t.key}
            className={cn('rounded-xl border bg-card p-3 text-left hover:border-primary/50', filter === t.key && 'border-primary ring-1 ring-primary')}>
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className={cn('text-2xl font-semibold tabular-nums', t.tone)}>{t.value}</div>
          </button>
        ))}
        <div className="col-span-2 rounded-xl border bg-card p-3 md:col-span-1">
          <div className="text-xs text-muted-foreground">Việc quá hạn</div>
          <div className={cn('text-2xl font-semibold tabular-nums', overdueTasks > 0 && 'text-destructive')}>{overdueTasks}</div>
        </div>
      </div>
      <ProgressLegend />
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Dự án</TableHead><TableHead>Tình trạng</TableHead><TableHead className="min-w-56">Tiến độ việc</TableHead>
            <TableHead className="text-right">Quá hạn</TableHead><TableHead>Mốc tiếp theo</TableHead><TableHead>Thời gian</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {shown.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Không có dự án</TableCell></TableRow>}
            {shown.map((p) => {
              const g = p.progress;
              const h = g.health ? PROJECT_HEALTH[g.health] : null;
              return (
                <TableRow key={p.id} className="cursor-pointer align-top" data-testid="overview-row"
                  onClick={() => void navigate({ to: '/projects/$projectId', params: { projectId: p.id } })}>
                  <TableCell><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.code} · {p.memberCount} thành viên</div></TableCell>
                  <TableCell>
                    {h && <StatusBadge tone={h.tone}>{h.label}</StatusBadge>}
                    {g.healthReasons.map((r) => <div key={r} className="mt-1 max-w-64 text-xs text-muted-foreground">{r}</div>)}
                  </TableCell>
                  <TableCell>
                    <ProgressBar p={g} />
                    <div className="mt-1 text-xs text-muted-foreground">{g.done}/{g.total} việc xong · {g.total - g.done} chưa xong</div>
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', g.overdue > 0 && 'font-medium text-destructive')}>{g.overdue || '—'}</TableCell>
                  <TableCell className="text-sm">
                    {g.nextMilestone ? <><div>{g.nextMilestone.title}</div>
                      {g.nextMilestone.dueOn && <div className={cn('text-xs', g.nextMilestone.overdue ? 'text-destructive' : 'text-muted-foreground')}>
                        {g.nextMilestone.overdue ? 'quá hạn ' : 'hạn '}{fmtDate(g.nextMilestone.dueOn)}</div>}</>
                      : <span className="text-muted-foreground">—</span>}
                    {(p.milestonesOpen + p.milestonesAccepted) > 0 && <div className="text-xs text-muted-foreground">Đã nghiệm thu {p.milestonesAccepted}/{p.milestonesOpen + p.milestonesAccepted}</div>}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {p.startOn ? fmtDate(p.startOn) : '?'} → {p.endOn ? fmtDate(p.endOn) : 'chưa đặt'}
                    {g.timeElapsedPercent != null && <div className="text-xs text-muted-foreground">đã qua {g.timeElapsedPercent}%</div>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
