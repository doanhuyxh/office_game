import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { useAiActivityPage } from '../../hooks/useAccessTokens';
import { requestTone, TOOL_LABEL, WRITE_TOOLS } from '../../utils/labels';

/** Nhật ký request của trợ lý AI (module Audit), phân trang ở BE. `all` (HR) = mọi người, lọc `userId`; `showUser` = cột nhân viên. */
export function ActivityTable({ all, userId, showUser }: { all?: boolean; userId?: string | null; showUser?: boolean }) {
  const pg = usePageState(all ? 'ai-activity-all' : 'ai-activity', userId ?? '');
  const { data, isLoading } = useAiActivityPage({ all, userId, query: pg.query });
  if (isLoading) return <Spinner />;
  if (!data?.items.length) return <p className="py-6 text-center text-sm text-muted-foreground">Chưa có hoạt động nào.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Thời gian</TableHead>
            {showUser && <TableHead>Nhân viên</TableHead>}
            <TableHead>Ứng dụng</TableHead>
            <TableHead>Thao tác</TableHead>
            <TableHead>Kết quả</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(r.occurredAt)}</TableCell>
              {showUser && <TableCell>{r.fullName ?? r.userName ?? '—'}</TableCell>}
              <TableCell>{r.clientName}</TableCell>
              <TableCell>
                <div className={cn(r.tool && WRITE_TOOLS.has(r.tool) && 'font-medium')}>
                  {r.tool ? TOOL_LABEL[r.tool] ?? r.tool : 'Gọi API trực tiếp'}
                </div>
                <div className="font-mono text-xs text-muted-foreground">{r.method} {r.path}</div>
              </TableCell>
              <TableCell>
                <StatusBadge tone={requestTone(r.status)}>
                  {r.status < 300 ? 'Thành công' : r.status === 403 ? 'Bị chặn' : r.status === 429 ? 'Quá giới hạn' : `Lỗi ${r.status}`}
                </StatusBadge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePagination state={pg} total={data.total} unit="request" />
    </div>
  );
}
