import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TOOL_LABEL } from '@/features/ai-access';
import { formatDateTime } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import type { IAiUsageReport } from '../../types/report.types';

const Empty = ({ span }: { span: number }) => (
  <TableRow><TableCell colSpan={span} className="py-6 text-center text-muted-foreground">Chưa có dữ liệu</TableCell></TableRow>
);

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card">
      <div className="px-4 pt-3 text-sm font-medium">{title}</div>
      <div className="max-h-96 overflow-auto">{children}</div>
    </div>
  );
}

/** Thao tác (tool MCP) dùng nhiều nhất + ứng dụng AI (+ IP khi xem một người). */
export function AiUsageBreakdown({ data, single }: { data: IAiUsageReport; single?: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${data.ips ? 'xl:grid-cols-3' : 'xl:grid-cols-2'}`}>
      <Panel title="Thao tác">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Tool</TableHead><TableHead className="text-right">Request</TableHead>
            <TableHead className="text-right">Không thành công</TableHead>{!single && <TableHead className="text-right">Người</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {data.byTool.length === 0 && <Empty span={single ? 3 : 4} />}
            {data.byTool.map((t) => (
              <TableRow key={t.tool ?? '-'}>
                <TableCell>
                  <div>{t.tool ? TOOL_LABEL[t.tool] ?? t.tool : 'Gọi API trực tiếp'}</div>
                  <div className="font-mono text-xs text-muted-foreground">{t.tool ?? 'không qua tool MCP (vd kiểm tra token)'}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(t.total)}</TableCell>
                <TableCell className={`text-right tabular-nums ${t.errors ? 'text-destructive' : 'text-muted-foreground'}`}>{formatNumber(t.errors)}</TableCell>
                {!single && <TableCell className="text-right tabular-nums">{formatNumber(t.users)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      <Panel title="Ứng dụng AI">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Ứng dụng / token</TableHead><TableHead className="text-right">Request</TableHead>{!single && <TableHead className="text-right">Người</TableHead>}
          </TableRow></TableHeader>
          <TableBody>
            {data.byClient.length === 0 && <Empty span={single ? 2 : 3} />}
            {data.byClient.map((c) => (
              <TableRow key={c.clientName}>
                <TableCell>{c.clientName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(c.total)}</TableCell>
                {!single && <TableCell className="text-right tabular-nums">{formatNumber(c.users)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      {data.ips && (
        <Panel title="Địa chỉ IP">
          <Table>
            <TableHeader><TableRow><TableHead>IP</TableHead><TableHead className="text-right">Request</TableHead><TableHead>Gần nhất</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.ips.length === 0 && <Empty span={3} />}
              {data.ips.map((i) => (
                <TableRow key={i.ip}>
                  <TableCell className="font-mono text-xs">{i.ip}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(i.total)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(i.lastAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
