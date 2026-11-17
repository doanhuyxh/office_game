import { Link } from '@tanstack/react-router';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import { cn } from '@/utils/cn';
import { useAiUsageSessions } from '../../hooks/useAiUsage';
import type { IAiUsageFilter } from '../../types/aiUsage.types';
import { formatDuration, formatTokensShort, formatUsd, KIND_LABEL, SESSION_STATUS, totalTokens } from '../../utils/aiUsage';

const COLUMNS: ColumnDef[] = [
  { id: 'at', label: 'Thời điểm', required: true },
  { id: 'user', label: 'Người / bot' },
  { id: 'kind', label: 'Loại' },
  { id: 'task', label: 'Mã việc' },
  { id: 'model', label: 'Model' },
  { id: 'tokens', label: 'Token' },
  { id: 'cost', label: 'Chi phí' },
  { id: 'duration', label: 'Thời lượng' },
  { id: 'status', label: 'Trạng thái' },
];

/** Danh sách phiên agent (mới nhất trước, BE phân trang). Cột "Người / bot" chỉ khi admin / HR xem nhiều người. */
export function AiUsageSessions({ filter, showUser }: { filter: Partial<IAiUsageFilter>; showUser: boolean }) {
  const pg = usePageState('ai-usage-sessions', JSON.stringify(filter));
  const sessions = useAiUsageSessions(filter, pg.query);
  const cols = useColumns('ai-usage-sessions', COLUMNS);
  const v = (id: string) => (id === 'user' ? showUser && cols.show(id) : cols.show(id));
  const span = cols.span() - (showUser || !cols.show('user') ? 0 : 1);
  const rows = sessions.data?.items ?? [];

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Danh sách phiên</div>
        <ColumnsMenu state={cols} />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời điểm</TableHead>
            {v('user') && <TableHead>Người / bot</TableHead>}
            {v('kind') && <TableHead>Loại</TableHead>}
            {v('task') && <TableHead>Mã việc</TableHead>}
            {v('model') && <TableHead>Model</TableHead>}
            {v('tokens') && <TableHead className="text-right">Token</TableHead>}
            {v('cost') && <TableHead className="text-right">Chi phí</TableHead>}
            {v('duration') && <TableHead>Thời lượng</TableHead>}
            {v('status') && <TableHead>Trạng thái</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.isLoading && <TableRow><TableCell colSpan={span}><Spinner /></TableCell></TableRow>}
          {!sessions.isLoading && rows.length === 0 && (
            <TableRow><TableCell colSpan={span} className="py-6 text-center text-muted-foreground">Không có phiên nào trong khoảng này.</TableCell></TableRow>
          )}
          {rows.map((s) => {
            const st = SESSION_STATUS[s.status] ?? SESSION_STATUS.done;
            const tokens = totalTokens(s);
            return (
              <TableRow key={s.id} data-testid="ai-usage-session-row" className={s.status === 'failed' ? 'bg-destructive/5' : undefined}>
                <TableCell className="whitespace-nowrap">{formatDateTime(s.finishedAt)}</TableCell>
                {v('user') && <TableCell>{s.fullName ?? s.userName ?? '—'}</TableCell>}
                {v('kind') && <TableCell>{KIND_LABEL[s.kind] ?? s.kind}</TableCell>}
                {v('task') && (
                  <TableCell className="whitespace-nowrap">
                    {s.taskCode && s.projectId && s.taskId ? (
                      <Link to="/projects/$projectId" params={{ projectId: s.projectId }} search={{ task: s.taskId }}
                        className="font-mono text-xs text-primary hover:underline">{s.taskCode}</Link>
                    ) : <span className="font-mono text-xs">{s.taskCode ?? '—'}</span>}
                  </TableCell>
                )}
                {v('model') && <TableCell className="text-xs">{s.models.map((m) => m.model).join(', ')}</TableCell>}
                {v('tokens') && (
                  <TableCell className="text-right tabular-nums"
                    title={`${formatNumber(tokens, 0)} token — vào ${formatNumber(s.inputTokens, 0)} · ra ${formatNumber(s.outputTokens, 0)} · cache đọc ${formatNumber(s.cacheReadTokens, 0)} · cache ghi ${formatNumber(s.cacheWriteTokens, 0)}`}>
                    {formatTokensShort(tokens)}
                  </TableCell>
                )}
                {v('cost') && <TableCell className={cn('text-right tabular-nums', s.costUsd === null && 'text-muted-foreground')}>{formatUsd(s.costUsd)}</TableCell>}
                {v('duration') && <TableCell className="whitespace-nowrap">{formatDuration(s.durationSeconds)}</TableCell>}
                {v('status') && <TableCell><StatusBadge tone={st.tone}>{st.label}</StatusBadge></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <TablePagination state={pg} total={sessions.data?.total} unit="phiên" />
    </div>
  );
}
