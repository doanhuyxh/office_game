import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { useAiActivityPage } from '../../hooks/useAccessTokens';
import { requestTone, TOOL_LABEL, WRITE_TOOLS } from '../../utils/labels';
import { RequestSummary } from '../request-summary';

/** Cùng định nghĩa "lệnh ghi" với BE (AuditRules.IsWrite). */
const isWriteMethod = (m: string) => !['GET', 'HEAD', 'OPTIONS'].includes(m.toUpperCase());

/** Nhật ký request của trợ lý AI (module Audit), phân trang ở BE. `all` (HR) = mọi người, lọc `userId`; `showUser` = cột nhân viên. */
export function ActivityTable({ all, userId, showUser }: { all?: boolean; userId?: string | null; showUser?: boolean }) {
  const pg = usePageState(all ? 'ai-activity-all' : 'ai-activity', userId ?? '');
  const { data, isLoading } = useAiActivityPage({ all, userId, query: pg.query });
  const [openId, setOpenId] = useState<string | null>(null);
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
            <TableHead>IP</TableHead>
            <TableHead>Thao tác</TableHead>
            <TableHead>Kết quả</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((r) => {
            const write = isWriteMethod(r.method);
            const open = openId === r.id;
            return (
            <Fragment key={r.id}>
            <TableRow>
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-1">
                  {write ? (
                    <button type="button" onClick={() => setOpenId(open ? null : r.id)} aria-expanded={open}
                      aria-label={open ? 'Ẩn nội dung' : 'Xem nội dung'} title={open ? 'Ẩn nội dung' : 'Xem nội dung đã ghi'}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" data-testid="ai-request-expand">
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  ) : <span className="inline-block size-5" />}
                  {formatDateTime(r.occurredAt)}
                </div>
              </TableCell>
              {showUser && <TableCell>{r.fullName ?? r.userName ?? '—'}</TableCell>}
              <TableCell>{r.clientName}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs">{r.ip ?? '—'}</TableCell>
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
            {open && (
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={showUser ? 6 : 5} className="whitespace-normal pl-10">
                  <RequestSummary summary={r.requestSummary} path={r.path} />
                </TableCell>
              </TableRow>
            )}
            </Fragment>
            );
          })}
        </TableBody>
      </Table>
      <TablePagination state={pg} total={data.total} unit="request" />
    </div>
  );
}
