import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { BarChart3, FileSpreadsheet, RotateCcw } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SearchSelectField, type SearchOption } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { addDays, todayVn } from '@/utils/date';
import { downloadUrl } from '@/utils/money';
import { formatNumber } from '@/utils/number';
import { cn } from '@/utils/cn';
import { aiUsageApi } from '../../api/aiUsage.api';
import { useAiUsageSummary } from '../../hooks/useAiUsage';
import type { AiSessionKind, AiSessionStatus, AiUsageGroupBy, IAiUsageFilter, IAiUsageModelGroup, IAiUsageSummary } from '../../types/aiUsage.types';
import { formatTokensShort, formatUsd, GROUP_LABEL, KIND_LABEL, modelColor, SESSION_STATUS } from '../../utils/aiUsage';
import { AiUsageChart, type AiUsageMetric } from '../ai-usage-chart';
import { AiUsageSessions } from '../ai-usage-sessions';

const GROUPS: AiUsageGroupBy[] = ['day', 'month', 'year'];
const KINDS: AiSessionKind[] = ['task', 'chat', 'meeting', 'other'];
const STATUSES: AiSessionStatus[] = ['done', 'failed', 'skipped'];
const ALL = 'all';

interface UsageSearch { usage?: string; from?: string; to?: string; kind?: string; status?: string; user?: string }
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const isDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Ngày cuối tháng của "yyyy-MM". */
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
};

/**
 * Bộ lọc lưu trên URL (`?tab=usage&usage=month&from=…&to=…&kind=task&status=failed&user=…`) → reload / gửi link giữ nguyên.
 * Không `from` / `to` = mặc định: Ngày 30 ngày (BE), Tháng 12 tháng (BE), Năm = tất cả (10 năm — trần của BE).
 */
function useUsageFilter(canPickUser: boolean) {
  const search = useSearch({ strict: false }) as UsageSearch;
  const navigate = useNavigate();
  const group = (GROUPS as string[]).includes(search.usage ?? '') ? (search.usage as AiUsageGroupBy) : 'day';
  const kind = (KINDS as string[]).includes(search.kind ?? '') ? (search.kind as AiSessionKind) : null;
  const status = (STATUSES as string[]).includes(search.status ?? '') ? (search.status as AiSessionStatus) : null;
  const user = canPickUser ? (str(search.user) ?? ALL) : null;
  const from = isDate(str(search.from));
  const to = isDate(str(search.to));
  const filter = useMemo<IAiUsageFilter>(() => ({
    group, kind, status, userId: user,
    from: from ?? (group === 'year' ? `${Number(todayVn().slice(0, 4)) - 9}-01-01` : null),
    to,
  }), [group, kind, status, user, from, to]);

  const set = useCallback((patch: Partial<UsageSearch>) => {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => {
        const next = { ...prev, ...patch } as Record<string, unknown>;
        for (const k of Object.keys(patch)) if (!next[k]) delete next[k];
        return next;
      }) as never,
      replace: true,
    });
  }, [navigate]);
  return { filter, custom: !!(from || to), set, rawFrom: from, rawTo: to };
}

function Stat({ label, value, title, note, testId }: { label: string; value: string; title?: string; note?: string; testId: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 sm:p-4" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl" title={title}>{value}</div>
      {note && <div className="mt-0.5 text-[11px] text-warning">{note}</div>}
    </div>
  );
}

function Totals({ data }: { data: IAiUsageSummary }) {
  const t = data.total;
  const cache = t.cacheReadTokens + t.cacheWriteTokens;
  const allMissing = t.sessions > 0 && t.costMissing === t.sessions;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      <Stat testId="ai-usage-stat-input" label="Token vào" value={formatTokensShort(t.inputTokens)} title={`${formatNumber(t.inputTokens, 0)} token`} />
      <Stat testId="ai-usage-stat-output" label="Token ra" value={formatTokensShort(t.outputTokens)} title={`${formatNumber(t.outputTokens, 0)} token`} />
      <Stat testId="ai-usage-stat-cache" label="Token cache (đọc + ghi)" value={formatTokensShort(cache)}
        title={`Đọc ${formatNumber(t.cacheReadTokens, 0)} · ghi ${formatNumber(t.cacheWriteTokens, 0)} token`} />
      <Stat testId="ai-usage-stat-cost" label="Chi phí (USD)" value={allMissing ? '—' : formatUsd(t.costUsd)}
        note={t.costMissing > 0 ? `${formatNumber(t.costMissing, 0)} phiên không có chi phí` : undefined} />
      <Stat testId="ai-usage-stat-sessions" label="Số phiên" value={formatNumber(t.sessions, 0)} />
    </div>
  );
}

/** Gộp (kỳ × model) thành từng model cho bảng "Theo model". */
function byModel(groups: IAiUsageModelGroup[]) {
  const map = new Map<string, IAiUsageModelGroup>();
  for (const g of groups) {
    const m = map.get(g.model);
    map.set(g.model, m ? {
      ...m, sessions: m.sessions + g.sessions, inputTokens: m.inputTokens + g.inputTokens, outputTokens: m.outputTokens + g.outputTokens,
      cacheReadTokens: m.cacheReadTokens + g.cacheReadTokens, cacheWriteTokens: m.cacheWriteTokens + g.cacheWriteTokens,
      costUsd: m.costUsd + g.costUsd, costMissing: m.costMissing + g.costMissing,
    } : { ...g, bucket: '' });
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || b.sessions - a.sessions || a.model.localeCompare(b.model));
}

function ModelTable({ data }: { data: IAiUsageSummary }) {
  const rows = useMemo(() => byModel(data.groups), [data.groups]);
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
  const tok = (n: number) => <span title={`${formatNumber(n, 0)} token`}>{formatTokensShort(n)}</span>;
  const cost = (r: { costUsd: number; costMissing: number; sessions: number }) => (r.costMissing >= r.sessions ? '—' : formatUsd(r.costUsd));
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">Theo model</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Số phiên</TableHead>
            <TableHead className="text-right">Token vào</TableHead>
            <TableHead className="text-right">Token ra</TableHead>
            <TableHead className="text-right">Token cache</TableHead>
            <TableHead className="text-right">Chi phí</TableHead>
            <TableHead className="text-right">% chi phí</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.model} data-testid="ai-usage-model-row">
              <TableCell className="whitespace-nowrap"><span className={cn('mr-1.5 inline-block size-2.5 rounded-sm', modelColor(r.model))} />{r.model}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(r.sessions, 0)}</TableCell>
              <TableCell className="text-right tabular-nums">{tok(r.inputTokens)}</TableCell>
              <TableCell className="text-right tabular-nums">{tok(r.outputTokens)}</TableCell>
              <TableCell className="text-right tabular-nums" title={`Đọc ${formatNumber(r.cacheReadTokens, 0)} · ghi ${formatNumber(r.cacheWriteTokens, 0)} token`}>
                {formatTokensShort(r.cacheReadTokens + r.cacheWriteTokens)}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', r.costMissing >= r.sessions && 'text-muted-foreground')}
                title={r.costMissing > 0 ? `${r.costMissing} phiên không có chi phí` : undefined}>
                {cost(r)}{r.costMissing > 0 && r.costMissing < r.sessions && <span className="text-warning">*</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{totalCost > 0 ? `${formatNumber((r.costUsd / totalCost) * 100, 1)} %` : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Tổng</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumber(data.total.sessions, 0)}</TableCell>
            <TableCell className="text-right tabular-nums">{tok(data.total.inputTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{tok(data.total.outputTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTokensShort(data.total.cacheReadTokens + data.total.cacheWriteTokens)}</TableCell>
            <TableCell className="text-right tabular-nums">{cost(data.total)}</TableCell>
            <TableCell className="text-right tabular-nums">{totalCost > 0 ? '100 %' : '—'}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="text-xs text-muted-foreground">Một phiên dùng nhiều model được đếm ở từng model; dòng Tổng đếm mỗi phiên một lần. * có phiên không có chi phí.</p>
    </div>
  );
}

/** Ô chọn người / bot (chỉ admin / HR — chỉ khi đó mới tải danh bạ). Giá trị = id tài khoản; "Tất cả" = all. */
function UserPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const employees = useEmployees();
  const options = useMemo<SearchOption[]>(() => [
    { value: ALL, label: 'Tất cả' },
    ...(employees.data ?? []).filter((e) => e.userId).map((e) => ({
      value: e.userId!, label: `${e.code} · ${e.fullName}${e.account?.isBot ? ' (BOT)' : ''}`, hint: e.departmentName ?? undefined,
    })),
  ], [employees.data]);
  return (
    <div className="w-64 min-w-0" data-testid="ai-usage-user">
      <SearchSelectField id="ai-usage-user-select" label="Người / bot" value={value} options={options} onChange={onChange} />
    </div>
  );
}

function Empty() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground" data-testid="ai-usage-empty">
      <BarChart3 className="size-8" />
      <div className="font-medium text-foreground">Chưa có số liệu trong khoảng này</div>
      <p className="max-w-lg">Số liệu do agent-runner gửi sau mỗi phiên; người dùng Claude cá nhân qua MCP không có số token.</p>
    </div>
  );
}

/**
 * Kết nối AI → tab "Mức dùng AI" (TEST-136): token / chi phí theo phiên agent, gộp ngày / tháng / năm (giờ VN), theo model.
 * Mỗi người xem phần của mình; admin / HR có ô chọn người / bot (mặc định "Tất cả") — quyền thật ở back-end (TEST-134).
 */
export function AiUsageTab({ canPickUser }: { canPickUser: boolean }) {
  const { filter, custom, set, rawFrom, rawTo } = useUsageFilter(canPickUser);
  const summary = useAiUsageSummary(filter);
  const [metric, setMetric] = useState<AiUsageMetric>('tokens');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = (m: string) => setHidden((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  const data = summary.data;
  const shownFrom = rawFrom ?? (filter.group !== 'year' ? data?.from : null) ?? '';
  const shownTo = rawTo ?? data?.to ?? '';
  const month = filter.group === 'month';

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="ai-usage-tab">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label>Gộp theo</Label>
          <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Gộp theo">
            {GROUPS.map((g) => (
              <Button key={g} size="sm" variant={filter.group === g ? 'secondary' : 'ghost'} aria-pressed={filter.group === g} className="h-8 px-3"
                data-testid={`ai-usage-group-${g}`} onClick={() => set({ usage: g === 'day' ? undefined : g, from: undefined, to: undefined })}>
                {GROUP_LABEL[g]}
              </Button>
            ))}
          </div>
        </div>
        {filter.group !== 'year' && (
          <>
            <div className="grid w-40 gap-1.5">
              <Label htmlFor="ai-usage-from">Từ</Label>
              <Input id="ai-usage-from" type={month ? 'month' : 'date'} value={month ? shownFrom.slice(0, 7) : shownFrom}
                onChange={(e) => set({ from: e.target.value ? (month ? `${e.target.value}-01` : e.target.value) : undefined })} />
            </div>
            <div className="grid w-40 gap-1.5">
              <Label htmlFor="ai-usage-to">Đến</Label>
              <Input id="ai-usage-to" type={month ? 'month' : 'date'} value={month ? shownTo.slice(0, 7) : shownTo}
                onChange={(e) => set({ to: e.target.value ? (month ? monthEnd(e.target.value) : e.target.value) : undefined })} />
            </div>
          </>
        )}
        {custom && filter.group !== 'year' && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => set({ from: undefined, to: undefined })}>
            <RotateCcw className="size-4" /> {filter.group === 'day' ? '30 ngày gần nhất' : '12 tháng gần nhất'}
          </Button>
        )}
        <div className="w-40">
          <SelectField id="ai-usage-kind" label="Loại phiên" allowEmpty emptyLabel="Mọi loại" value={filter.kind}
            onChange={(v) => set({ kind: v ?? undefined })} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        </div>
        <div className="w-40">
          <SelectField id="ai-usage-status" label="Trạng thái" allowEmpty emptyLabel="Mọi trạng thái" value={filter.status}
            onChange={(v) => set({ status: v ?? undefined })} options={STATUSES.map((s) => ({ value: s, label: SESSION_STATUS[s].label }))} />
        </div>
        {canPickUser && (
          <UserPicker value={filter.userId} onChange={(v) => set({ user: v && v !== ALL ? v : undefined })} />
        )}
        <Button variant="outline" className="ms-auto" data-testid="ai-usage-export" onClick={() => downloadUrl(aiUsageApi.exportUrl(filter))}>
          <FileSpreadsheet className="size-4" /> Xuất Excel
        </Button>
      </div>

      {summary.isLoading || !data ? (summary.isError ? <p className="text-sm text-destructive">Không tải được số liệu.</p> : <Spinner />) : data.total.sessions === 0 ? <Empty /> : (
        <>
          <Totals data={data} />
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Theo {GROUP_LABEL[data.group].toLowerCase()} · từng model</div>
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Chỉ số biểu đồ">
                {(['tokens', 'cost'] as const).map((m) => (
                  <Button key={m} size="sm" variant={metric === m ? 'secondary' : 'ghost'} aria-pressed={metric === m} className="h-7 px-3"
                    data-testid={`ai-usage-metric-${m}`} onClick={() => setMetric(m)}>
                    {m === 'tokens' ? 'Token' : 'Chi phí'}
                  </Button>
                ))}
              </div>
            </div>
            <AiUsageChart data={data} metric={metric} hidden={hidden} onToggle={toggle} />
          </div>
          <div className="rounded-xl border bg-card p-4"><ModelTable data={data} /></div>
        </>
      )}

      <div className="rounded-xl border bg-card p-4">
        <AiUsageSessions filter={filter} showUser={canPickUser && filter.userId === ALL} />
      </div>
    </div>
  );
}

export default AiUsageTab;
