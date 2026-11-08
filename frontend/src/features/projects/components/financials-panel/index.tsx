import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { formatMoney } from '@/utils/money';
import { useFinancials } from '../../hooks/useProjects';
import type { IProjectDetail } from '../../types/project.types';
import { fmtMonth } from '../../utils/labels';

const days = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const CONTRACT_STATUS: Record<string, string> = { Active: 'Hiệu lực', Completed: 'Hoàn thành', Cancelled: 'Đã huỷ' };

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="grid gap-0.5 rounded-xl border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === 'neg' ? 'text-rose-600' : tone === 'pos' ? 'text-emerald-600' : ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

/**
 * Lãi / lỗ dự án — chỉ người có quyền Xem tài chính (back-end chặn 403 với người khác, kể cả quản lý dự án).
 * Doanh thu = giá trị hợp đồng sau thuế; VAT, nhân công (ngày công × chi phí lương), chi trực tiếp gắn dự án là chi phí. Không phân bổ chi phí chung.
 */
export function FinancialsPanel({ d }: { d: IProjectDetail }) {
  const { data: f, isLoading, error } = useFinancials(d.project.id, true);
  if (isLoading) return <Spinner />;
  if (error || !f) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const income = f.revenue + f.otherIncome;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Tile label="Doanh thu (gồm VAT)" value={formatMoney(f.revenue)} hint={f.otherIncome ? `+ thu khác ${formatMoney(f.otherIncome)}` : `${f.contracts.length} hợp đồng`} />
        <Tile label="VAT" value={formatMoney(f.vat)} />
        <Tile label="Nhân công" value={formatMoney(f.labor)} hint={`${days(f.manDays)} ngày công${f.hasEstimate ? ' · có tháng ước tính' : ''}`} />
        <Tile label="Chi trực tiếp" value={formatMoney(f.directExpense)} />
        <Tile label={f.profit < 0 ? 'Lỗ' : 'Lãi'} value={formatMoney(f.profit)} tone={f.profit < 0 ? 'neg' : 'pos'}
          hint={f.marginPercent != null ? `Biên ${f.marginPercent.toLocaleString('vi-VN')}%` : income ? undefined : 'Chưa có doanh thu'} />
        <Tile label="Đã thu / còn nợ" value={formatMoney(f.collected)} hint={`Còn phải thu ${formatMoney(f.outstanding)}`} />
      </div>
      {f.hasEstimate && <p className="text-xs text-muted-foreground">Tháng chưa chốt kỳ lương: nhân công là <b>ước tính</b> theo hợp đồng lao động + chấm công tới hôm nay, sẽ cố định khi HR chốt bảng lương.</p>}

      {f.contracts.length > 0 && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Hợp đồng</TableHead><TableHead>Khách</TableHead><TableHead className="text-right">Trước thuế</TableHead>
              <TableHead className="text-right">Sau thuế</TableHead><TableHead className="text-right">Đã thu</TableHead><TableHead className="text-right">Còn nợ</TableHead></TableRow></TableHeader>
            <TableBody>
              {f.contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><b>{c.code}</b> · {c.title} {c.status !== 'Active' && <StatusBadge tone={c.status === 'Cancelled' ? 'danger' : 'muted'}>{CONTRACT_STATUS[c.status] ?? c.status}</StatusBadge>}</TableCell>
                  <TableCell>{c.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.valueBeforeTax)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.totalValue)} <span className="text-xs text-muted-foreground">VAT {c.vatRate}%</span></TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.collected)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.outstanding)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Tháng</TableHead><TableHead className="text-right">Ngày công</TableHead><TableHead className="text-right">Nhân công</TableHead>
            <TableHead className="text-right">Chi trực tiếp</TableHead><TableHead className="text-right">Thu khác</TableHead><TableHead className="text-right">Khách đã trả</TableHead></TableRow></TableHeader>
          <TableBody>
            {f.months.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">Chưa có số liệu</TableCell></TableRow>}
            {f.months.map((m) => (
              <TableRow key={m.month}>
                <TableCell>{fmtMonth(m.month)}</TableCell>
                <TableCell className="text-right tabular-nums">{days(m.manDays)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(m.labor)}{m.laborEstimated && <span className="text-xs text-muted-foreground"> (ước tính)</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(m.directExpense)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(m.otherIncome)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(m.collected)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-2 rounded-xl border bg-card p-3">
          <div className="text-sm font-medium">Thu / chi trực tiếp theo danh mục</div>
          {f.categories.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có giao dịch gắn dự án — khi ghi sổ / đề nghị chi, chọn "Dự án" để tính vào đây.</p>
            : f.categories.map((c) => (
              <div key={`${c.isIncome}-${c.name}`} className="flex justify-between text-sm"><span>{c.isIncome ? 'Thu · ' : ''}{c.name}</span>
                <span className={`tabular-nums ${c.isIncome ? 'text-emerald-600' : ''}`}>{formatMoney(c.amount)}</span></div>))}
        </div>
        {f.people && (
          <div className="grid content-start gap-2 rounded-xl border bg-card p-3">
            <div className="text-sm font-medium">Nhân công theo người <span className="font-normal text-muted-foreground">— chỉ Quản trị tài chính</span></div>
            {f.people.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có ngày công.</p> : f.people.map((x) => (
              <div key={x.employeeId} className="flex justify-between gap-2 text-sm"><span>{x.fullName}</span>
                <span className="tabular-nums">{days(x.manDays)} ngày · {formatMoney(x.labor)}</span></div>))}
          </div>
        )}
      </div>
    </div>
  );
}
