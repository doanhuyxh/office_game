import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { Skeleton } from '@/components/common/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatMoney } from '@/utils/money';
import { useDashboard, useOverview } from '../../hooks/useFinance';
import { ACCOUNT_KIND_LABEL, fmtDate, fmtMonth } from '../../utils/labels';
import { BlockCard } from '../block-card';
import { BlockState } from '../block-state';
import { LineMonthCard } from '../line-month-card';
import { MonthFlowChart } from '../month-flow-chart';
import { PipelineCard } from '../pipeline-card';
import { ProjectAlertsCard } from '../project-alerts-card';
import { ReceivablesCard } from '../receivables-card';

type Tone = 'pos' | 'neg';
const TONE: Record<Tone, string> = { pos: 'text-success', neg: 'text-destructive' };

function Stat({ label, value, sub, tone, loading, testId }: { label: string; value?: string; sub?: string; tone?: Tone; loading?: boolean; testId?: string }) {
  return (
    <Card className="gap-1 py-4" data-testid={testId}>
      <CardHeader className="px-4"><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className="px-4">
        {loading ? <Skeleton className="h-7 w-32" /> : <div className={`text-xl font-semibold tabular-nums ${tone ? TONE[tone] : ''}`} data-testid={testId && `${testId}-value`}>{value ?? '—'}</div>}
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/**
 * Tổng quan giám đốc (người có quyền Xem tài chính): thẻ số, thu / chi / lãi 12 tháng (biểu đồ + bảng), theo mảng (chọn tháng),
 * công nợ quá hạn, pipeline, dự án cần chú ý, quỹ. Ba nguồn tải song song (`/overview`, `/dashboard`, `/projects/financials/alerts`),
 * mỗi khối tự xử lý đang tải / lỗi / rỗng. FE chỉ hiển thị số API trả.
 */
export function OverviewTab() {
  const ov = useOverview(true);
  const db = useDashboard(12);
  const o = ov.data;
  const d = db.data;
  const monthProfit = o ? o.monthIncome - o.monthExpense : undefined;
  const months = d?.monthly ?? [];
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 @7xl/content:grid-cols-4 @min-[112rem]/content:grid-cols-7">
        <Stat testId="stat-balance" label="Tổng số dư các quỹ" loading={ov.isLoading} value={o && formatMoney(o.totalBalance)}
          sub={o ? (o.lockedThrough ? `Sổ đã khoá đến hết ${fmtDate(o.lockedThrough)}` : 'Chưa khoá sổ') : undefined} />
        <Stat testId="stat-income" label="Thu tháng này" loading={ov.isLoading} value={o && formatMoney(o.monthIncome)} sub={o && `từ ${fmtDate(o.monthStart)}`} tone="pos" />
        <Stat testId="stat-expense" label="Chi tháng này" loading={ov.isLoading} value={o && formatMoney(o.monthExpense)} sub="không tính chuyển quỹ" tone="neg" />
        <Stat testId="stat-profit" label="Lãi tháng này" loading={ov.isLoading} value={monthProfit === undefined ? undefined : formatMoney(monthProfit)} sub="thu − chi theo sổ" tone={monthProfit !== undefined && monthProfit < 0 ? 'neg' : 'pos'} />
        <Stat testId="stat-overdue" label="Công nợ quá hạn" loading={db.isLoading} value={d && formatMoney(d.receivables.overdue)} sub={d && `${d.receivables.overdueCount} đợt · còn phải thu ${formatMoney(d.receivables.outstanding)}`}
          tone={d && d.receivables.overdue > 0 ? 'neg' : undefined} />
        <Stat testId="stat-pipeline" label="Pipeline có trọng số" loading={db.isLoading} value={d && formatMoney(d.pipeline.weighted)} sub={d && `${d.pipeline.openCount} cơ hội · giá trị ${formatMoney(d.pipeline.openValue)}`} />
        <Stat testId="stat-expenses" label="Đề nghị chi" loading={ov.isLoading} value={o && `${o.expenseAwaitingPayment} chờ chi · ${o.expensePending} chờ duyệt`}
          sub={o && `${formatMoney(o.expenseAwaitingAmount)} chờ chi · ${formatMoney(o.expensePendingAmount)} chờ duyệt`} />
      </div>
      {ov.error && <BlockState error={ov.error} onRetry={() => void ov.refetch()} retrying={ov.isFetching} />}

      <BlockCard testId="month-flow-card" title="Thu / chi / lãi 12 tháng" hint="Tiền thực thu / thực chi của sổ quản trị (không phải doanh thu ghi nhận), không tính chuyển quỹ">
        {db.isLoading || db.error || !d
          ? <BlockState loading={db.isLoading} error={db.error} onRetry={() => void db.refetch()} retrying={db.isFetching} rows={6} />
          : <>
            <MonthFlowChart months={months} />
            <Table containerClassName="max-h-80 overflow-auto">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0">
                <TableRow><TableHead>Tháng</TableHead><TableHead className="text-right">Thu</TableHead><TableHead className="text-right">Chi</TableHead><TableHead className="text-right">Lãi</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {[...months].reverse().map((m) => (
                  <TableRow key={m.month} data-testid="month-row">
                    <TableCell>{fmtMonth(m.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(m.income)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(m.expense)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${m.profit < 0 ? 'text-destructive' : ''}`}>{formatMoney(m.profit)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium">
                  <TableCell>Cộng {d.months} tháng</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(d.totals.income)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(d.totals.expense)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${d.totals.profit < 0 ? 'text-destructive' : ''}`}>{formatMoney(d.totals.profit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>}
      </BlockCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 @7xl/content:grid-cols-2 @min-[112rem]/content:grid-cols-3">
        {d ? <LineMonthCard months={months} /> : <BlockCard title="Theo mảng kinh doanh"><BlockState loading={db.isLoading} error={db.error} /></BlockCard>}
        {d ? <ReceivablesCard data={d.receivables} /> : <BlockCard title="Công nợ quá hạn"><BlockState loading={db.isLoading} error={db.error} /></BlockCard>}
        {d ? <PipelineCard data={d.pipeline} /> : <BlockCard title="Pipeline cơ hội"><BlockState loading={db.isLoading} error={db.error} /></BlockCard>}
        <ProjectAlertsCard />
        <BlockCard testId="accounts-card" title="Quỹ / tài khoản">
          {ov.isLoading || ov.error || !o
            ? <BlockState loading={ov.isLoading} error={ov.error} />
            : (
              <Table>
                <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Loại</TableHead><TableHead className="text-right">Số dư</TableHead></TableRow></TableHeader>
                <TableBody>
                  {o.accounts.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">Chưa có quỹ — người có quyền Quản trị tài chính tạo ở tab Cấu hình</TableCell></TableRow>}
                  {o.accounts.map((a) => (
                    <TableRow key={a.id} className={a.isActive ? undefined : 'opacity-60'}>
                      <TableCell className="font-medium">{a.name}{a.last4 && <span className="text-muted-foreground"> · …{a.last4}</span>}{!a.isActive && ' (đã đóng)'}</TableCell>
                      <TableCell>{ACCOUNT_KIND_LABEL[a.kind]}{a.bankName && ` · ${a.bankName}`}</TableCell>
                      <TableCell className={`text-right tabular-nums ${a.balance < 0 ? 'text-destructive' : ''}`}>{formatMoney(a.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </BlockCard>
      </div>
      <p className="text-xs text-muted-foreground">Đây là sổ quản trị nội bộ — không thay sổ sách kế toán / báo cáo thuế theo luật và không phát hành hoá đơn điện tử.</p>
    </div>
  );
}
