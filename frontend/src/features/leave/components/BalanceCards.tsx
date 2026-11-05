import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import type { IBalance } from '../types/leave.types';
import { fmtDays } from '../utils/labels';

/** Số dư phép năm của tôi. */
export function BalanceCard({ b }: { b: IBalance }) {
  const rows: [string, number, string?][] = [
    [`Tích luỹ năm ${b.year} (${b.entitlementThisYear} ngày/năm)`, b.accruedThisYear],
    ['Chuyển từ các năm trước', b.carriedFromPreviousYears],
    ['Điều chỉnh của HR', b.adjustedThisYear],
    [`Đã nghỉ năm ${b.year}`, -b.usedThisYear],
    ['Đang chờ duyệt', -b.pending],
  ];
  return (
    <Card>
      <CardHeader>
        <CardDescription>Phép năm còn lại</CardDescription>
        <CardTitle className="text-3xl" data-testid="leave-available">{fmtDays(b.available)} <span className="text-base font-normal text-muted-foreground">ngày</span></CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-1 text-sm">
          {rows.map(([label, v]) => (
            <div key={label} className="flex justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-mono tabular-nums">{v > 0 ? '+' : ''}{fmtDays(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Cộng dồn mỗi tháng; +1 ngày/năm cho mỗi 5 năm thâm niên.</p>
      </CardContent>
    </Card>
  );
}

/** Phép còn lại cuối năm: chuyển sang năm sau (tự động, không hết hạn) hoặc quy ra tiền (đang phát triển). */
export function YearEndCard({ b }: { b: IBalance }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Phép chưa dùng cuối năm {b.year}</CardDescription>
        <CardTitle className="text-base">Chọn cách xử lý</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="rounded-lg border border-primary bg-accent p-3">
          <b>Chuyển sang năm {b.year + 1}</b>
          <p className="text-muted-foreground">Áp dụng tự động cho số phép còn lại. Phép chuyển sang <b>không có hạn sử dụng</b>.</p>
        </div>
        <div className="rounded-lg border p-3 opacity-60">
          <div className="flex items-center justify-between gap-2">
            <b>Quy ra tiền</b>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs">Đang phát triển</span>
          </div>
          <p className="text-muted-foreground">Thanh toán theo lương ngày công. Nhân viên đề xuất, HR duyệt.</p>
          <Button size="sm" variant="outline" className="mt-2" disabled>Đề xuất quy ra tiền</Button>
        </div>
      </CardContent>
    </Card>
  );
}
