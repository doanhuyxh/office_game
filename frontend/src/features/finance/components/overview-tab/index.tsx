import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatMoney } from '@/utils/money';
import { useOverview } from '../../hooks/useFinance';
import { ACCOUNT_KIND_LABEL, fmtDate } from '../../utils/labels';

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4"><CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className="px-4">
        <div className={`text-xl font-semibold tabular-nums ${tone === 'pos' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'neg' ? 'text-rose-600 dark:text-rose-400' : ''}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/** Tổng quan (người có quyền Xem tài chính): số dư các quỹ, thu / chi tháng này theo mảng, đề nghị chi đang chờ. */
export function OverviewTab() {
  const { data, isLoading } = useOverview(true);
  if (isLoading || !data) return <Spinner />;
  const month = `từ ${fmtDate(data.monthStart)}`;
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 @min-[112rem]/content:grid-cols-[repeat(4,minmax(0,28rem))]">
        <Stat label="Tổng số dư các quỹ đang dùng" value={formatMoney(data.totalBalance)} sub={data.lockedThrough ? `Sổ đã khoá đến hết ${fmtDate(data.lockedThrough)}` : 'Chưa khoá sổ'} />
        <Stat label="Thu tháng này" value={formatMoney(data.monthIncome)} sub={month} tone="pos" />
        <Stat label="Chi tháng này" value={formatMoney(data.monthExpense)} sub={`Chênh lệch ${formatMoney(data.monthIncome - data.monthExpense)}`} tone="neg" />
        <Stat label="Đề nghị chi" value={`${data.expenseAwaitingPayment} chờ chi · ${data.expensePending} chờ duyệt`}
          sub={`${formatMoney(data.expenseAwaitingAmount)} chờ chi · ${formatMoney(data.expensePendingAmount)} chờ duyệt`} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border bg-card">
          <div className="px-4 pt-3 text-sm font-medium">Quỹ / tài khoản</div>
          <Table>
            <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Loại</TableHead><TableHead className="text-right">Số dư</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.accounts.length === 0 && <TableRow><TableCell colSpan={3} className="py-6 text-center text-muted-foreground">Chưa có quỹ — người có quyền Quản trị tài chính tạo ở tab Cấu hình</TableCell></TableRow>}
              {data.accounts.map((a) => (
                <TableRow key={a.id} className={a.isActive ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">{a.name}{a.last4 && <span className="text-muted-foreground"> · …{a.last4}</span>}{!a.isActive && ' (đã đóng)'}</TableCell>
                  <TableCell>{ACCOUNT_KIND_LABEL[a.kind]}{a.bankName && ` · ${a.bankName}`}</TableCell>
                  <TableCell className={`text-right tabular-nums ${a.balance < 0 ? 'text-rose-600' : ''}`}>{formatMoney(a.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="rounded-xl border bg-card">
          <div className="px-4 pt-3 text-sm font-medium">Theo mảng kinh doanh — tháng này <span className="font-normal text-muted-foreground">(không tính chuyển quỹ)</span></div>
          <Table>
            <TableHeader><TableRow><TableHead>Mảng</TableHead><TableHead className="text-right">Thu</TableHead><TableHead className="text-right">Chi</TableHead><TableHead className="text-right">Chênh lệch</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.byLine.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Chưa có giao dịch trong tháng</TableCell></TableRow>}
              {data.byLine.map((l) => (
                <TableRow key={l.businessLineId ?? 'none'}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.income)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.expense)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${l.income - l.expense < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatMoney(l.income - l.expense)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Đây là sổ quản trị nội bộ — không thay sổ sách kế toán / báo cáo thuế theo luật và không phát hành hoá đơn điện tử.</p>
    </div>
  );
}
