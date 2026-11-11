import { useMemo, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/common/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { hasRole, useMe } from '@/features/auth';
import { useDepartments } from '@/features/employees';
import { addDays, formatDateTime, todayVn } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import { cn } from '@/utils/cn';
import { useAiUsage, useAiUsageUsersPage } from '../../hooks/useReports';
import type { AiUsageKind, AiUsageSort, IAiUsageFilter } from '../../types/report.types';
import { AiUsageBreakdown } from '../ai-usage-breakdown';
import { AiUsageChart } from '../ai-usage-chart';
import { AiUsageStats } from '../ai-usage-stats';
import { AiUsageUserSheet, type AiUsagePerson } from '../ai-usage-user-sheet';

const ALL = '__all__';
/** Khớp hạn lưu nhật ký AI ở back-end (AuditRules.AiRetentionDays). */
const RANGES = [
  { value: '1', label: 'Hôm nay' },
  { value: '7', label: '7 ngày qua' },
  { value: '30', label: '30 ngày qua' },
  { value: '90', label: '90 ngày qua' },
  { value: '180', label: '180 ngày qua' },
];
const KINDS: { value: AiUsageKind; label: string }[] = [
  { value: 'tool', label: 'Qua tool MCP' },
  { value: 'api', label: 'Gọi API trực tiếp' },
];

function FilterSelect({ value, onChange, options, allLabel, label, className }: {
  value: string | null; onChange: (v: string | null) => void; options: { value: string; label: string }[];
  allLabel?: string; label: string; className?: string;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className={cn('h-9 w-44', className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={ALL}>{allLabel}</SelectItem>}
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Tiêu đề cột bấm được để sắp xếp (giảm dần; back-end sắp xếp + phân trang). */
function SortHead({ id, sort, onSort, children, className }: {
  id: AiUsageSort; sort: AiUsageSort; onSort: (s: AiUsageSort) => void; children: React.ReactNode; className?: string;
}) {
  return (
    <TableHead className={className}>
      <button type="button" onClick={() => onSort(id)} className={cn('inline-flex items-center gap-1 hover:text-foreground', sort === id && 'text-foreground')}>
        {children}{sort === id && <ArrowDown className="size-3" />}
      </button>
    </TableHead>
  );
}

/**
 * Báo cáo → Trợ lý AI: lượng request nhân viên gọi qua MCP / token AI (nhật ký module Audit, lưu 180 ngày).
 * HR / admin: cả công ty, lọc phòng ban; quản lý: bản thân + cấp dưới (back-end giới hạn).
 */
export function AiUsageTab() {
  const { data: me } = useMe();
  const isHr = hasRole(me, 'admin', 'hr');
  const departments = useDepartments();
  const [range, setRange] = useState('30');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [client, setClient] = useState<string | null>(null);
  const [kind, setKind] = useState<AiUsageKind | null>(null);
  const [sort, setSort] = useState<AiUsageSort>('total');
  const [person, setPerson] = useState<AiUsagePerson | null>(null);

  const filter = useMemo<IAiUsageFilter>(() => {
    const to = todayVn();
    return { from: addDays(to, 1 - Number(range)), to, departmentId: isHr ? departmentId : null, client, kind };
  }, [range, departmentId, client, kind, isHr]);
  const report = useAiUsage(filter);
  const pg = usePageState('report-ai-usage', `${JSON.stringify(filter)}|${sort}`);
  const users = useAiUsageUsersPage(filter, sort, pg.query);
  const rows = users.data?.items ?? [];

  // Danh sách ứng dụng lấy từ kết quả hiện tại; giữ lựa chọn đang lọc để không mất khỏi danh sách.
  const clientOptions = useMemo(() => {
    const names = new Set((report.data?.byClient ?? []).map((c) => c.clientName));
    if (client) names.add(client);
    return [...names].sort().map((n) => ({ value: n, label: n }));
  }, [report.data, client]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Request trợ lý AI (Claude, Codex, ChatGPT…) gọi thay nhân viên qua MCP / token AI. {isHr ? 'Toàn công ty.' : 'Bạn và cấp dưới.'} Bấm một người để xem chi tiết.
        </p>
        <div className="flex flex-wrap gap-2">
          <FilterSelect label="Khoảng thời gian" value={range} onChange={(v) => setRange(v ?? '30')} options={RANGES} className="w-36" />
          {isHr && (
            <FilterSelect label="Phòng ban" value={departmentId} onChange={setDepartmentId} allLabel="Mọi phòng ban"
              options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
          )}
          <FilterSelect label="Ứng dụng" value={client} onChange={setClient} allLabel="Mọi ứng dụng" options={clientOptions} />
          <FilterSelect label="Loại" value={kind} onChange={(v) => setKind(v as AiUsageKind | null)} allLabel="Mọi loại" options={KINDS} className="w-40" />
        </div>
      </div>

      {report.isLoading || !report.data ? <Spinner /> : (
        <>
          <AiUsageStats s={report.data.summary} />
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 text-sm font-medium">Theo ngày</div>
            <AiUsageChart days={report.data.daily} />
          </div>
        </>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <div className="px-4 pt-3 text-sm font-medium">Theo nhân viên</div>
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead id="name" sort={sort} onSort={setSort}>Nhân viên</SortHead>
              <TableHead>Phòng ban</TableHead>
              <SortHead id="total" sort={sort} onSort={setSort} className="text-right">Request</SortHead>
              <SortHead id="writes" sort={sort} onSort={setSort} className="text-right">Ghi</SortHead>
              <SortHead id="errors" sort={sort} onSort={setSort} className="text-right">Lỗi</SortHead>
              <SortHead id="blocked" sort={sort} onSort={setSort} className="text-right">Bị chặn</SortHead>
              <SortHead id="ips" sort={sort} onSort={setSort} className="text-right">IP</SortHead>
              <TableHead>Ứng dụng chính</TableHead>
              <SortHead id="last" sort={sort} onSort={setSort}>Gần nhất</SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.isLoading && <TableRow><TableCell colSpan={9}><Spinner /></TableCell></TableRow>}
            {!users.isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Không có ai dùng trợ lý AI trong khoảng này.</TableCell></TableRow>
            )}
            {rows.map((r) => {
              const name = r.fullName ?? r.userName ?? '—';
              return (
                <TableRow key={r.userId} className="cursor-pointer" data-testid="ai-usage-user-row"
                  onClick={() => setPerson({ userId: r.userId, name, departmentName: r.departmentName })}>
                  <TableCell>
                    {r.employeeCode && <span className="font-mono text-xs text-muted-foreground">{r.employeeCode}</span>} {name}
                    {r.isBot && <BotBadge className="ml-1.5" />}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.departmentName ?? '—'}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatNumber(r.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.writes)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.errors ? 'text-destructive' : 'text-muted-foreground')}>{formatNumber(r.errors)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', r.blocked ? 'text-warning' : 'text-muted-foreground')}>{formatNumber(r.blocked)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(r.ips)}</TableCell>
                  <TableCell>{r.topClient ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.lastAt)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={users.data?.total} unit="người" />
      </div>

      {report.data && <AiUsageBreakdown data={report.data} />}

      <AiUsageUserSheet person={person} filter={filter} onClose={() => setPerson(null)} />
    </div>
  );
}
