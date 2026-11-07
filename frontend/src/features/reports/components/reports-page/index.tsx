import { useState } from 'react';
import { AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Input } from '@/components/common/input';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportTable } from '@/features/attendance';
import { currentMonthVn, formatDate } from '@/utils/date';
import { downloadUrl, formatMoney } from '@/utils/money';
import { excelUrl } from '../../api/report.api';
import { useLeavePayoutPage, useOvertimePayPage } from '../../hooks/useReports';
import { days, hours } from '../../utils/labels';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';
import { useTabParam } from '@/hooks/useTabParam';

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="w-44" aria-label="Chọn tháng" />;
}

const ExcelButton = ({ url, label = 'Xuất Excel' }: { url: string; label?: string }) => (
  <Button variant="outline" onClick={() => downloadUrl(url)}><FileSpreadsheet className="size-4" /> {label}</Button>
);

const Warn = ({ text }: { text: string | null }) =>
  text ? <span className="inline-flex items-center gap-1 text-xs text-warning"><AlertTriangle className="size-3.5" />{text}</span> : null;

function TimesheetTab() {
  const [month, setMonth] = useState(currentMonthVn);
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Bấm một dòng để xem bảng công chi tiết. File Excel gồm 3 sheet: tổng hợp, lưới công theo ngày, chi tiết giờ vào / ra (giờ VN).</p>
        <div className="flex gap-2"><MonthPicker value={month} onChange={setMonth} /><ExcelButton url={excelUrl.timesheet(month)} /></div>
      </div>
      <ReportTable month={month} />
    </div>
  );
}

const OVERTIME_COLUMNS: ColumnDef[] = [
  { id: 'employee', label: 'Nhân viên', required: true }, { id: 'salary', label: 'Lương HĐ' }, { id: 'std', label: 'Công chuẩn' },
  { id: 'hourly', label: 'Lương giờ' }, { id: 'w150', label: '150% (ngày thường)' }, { id: 'w200', label: '200% (nghỉ tuần)' },
  { id: 'w300', label: '300% (lễ)' }, { id: 'total', label: 'Tổng giờ' }, { id: 'amount', label: 'Thành tiền' },
];
const PAYOUT_COLUMNS: ColumnDef[] = [
  { id: 'employee', label: 'Nhân viên', required: true }, { id: 'accrued', label: 'Tích luỹ năm nay' }, { id: 'carried', label: 'Năm trước chuyển' },
  { id: 'used', label: 'Đã dùng' }, { id: 'pending', label: 'Chờ duyệt' }, { id: 'available', label: 'Còn lại' },
  { id: 'daily', label: 'Lương ngày' }, { id: 'payout', label: 'Tiền phép' },
];

function OvertimePayTab() {
  const [month, setMonth] = useState(currentMonthVn);
  const pg = usePageState('report-overtime', month);
  const { data, isLoading } = useOvertimePayPage(month, pg.query); // chỉ người có tăng ca; tổng tháng tính trên toàn bộ
  const rows = data?.items ?? [];
  const cols = useColumns('report-overtime', OVERTIME_COLUMNS);
  const v = cols.show;
  const before = ['employee', 'salary', 'std', 'hourly', 'w150', 'w200', 'w300'].filter(v).length;
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Chỉ đơn tăng ca <b>đã duyệt</b>. Lương giờ = lương hợp đồng ÷ ngày công chuẩn của tháng ÷ 8 (không gồm phụ cấp); ngày công chuẩn tính cả ngày lễ.
        </p>
        <div className="flex gap-2"><MonthPicker value={month} onChange={setMonth} /><ColumnsMenu state={cols} className="h-9" /><ExcelButton url={excelUrl.overtimePay(month)} /></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nhân viên</TableHead>
              {v('salary') && <TableHead className="text-right">Lương HĐ</TableHead>}
              {v('std') && <TableHead className="text-right">Công chuẩn</TableHead>}
              {v('hourly') && <TableHead className="text-right">Lương giờ</TableHead>}
              {v('w150') && <TableHead className="text-right">150%</TableHead>}
              {v('w200') && <TableHead className="text-right">200%</TableHead>}
              {v('w300') && <TableHead className="text-right">300%</TableHead>}
              {v('total') && <TableHead className="text-right">Tổng giờ</TableHead>}
              {v('amount') && <TableHead className="text-right">Thành tiền</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={cols.span()}><Spinner /></TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={cols.span()} className="py-6 text-center text-muted-foreground">Không có tăng ca đã duyệt trong tháng.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.employee.id}>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}
                  <div><Warn text={r.warning} /></div>
                </TableCell>
                {v('salary') && <TableCell className="text-right">{formatMoney(r.salary)}</TableCell>}
                {v('std') && <TableCell className="text-right">{r.standardDays}</TableCell>}
                {v('hourly') && <TableCell className="text-right">{formatMoney(r.hourlyWage)}</TableCell>}
                {v('w150') && <TableCell className="text-right font-mono">{hours(r.weekdayMinutes)}</TableCell>}
                {v('w200') && <TableCell className="text-right font-mono">{hours(r.restDayMinutes)}</TableCell>}
                {v('w300') && <TableCell className="text-right font-mono">{hours(r.holidayMinutes)}</TableCell>}
                {v('total') && <TableCell className="text-right font-mono">{hours(r.totalMinutes)}</TableCell>}
                {v('amount') && <TableCell className="text-right font-medium">{formatMoney(r.totalAmount)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && data && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={before}>Tổng tháng {month.slice(5)}/{month.slice(0, 4)}</TableCell>
                {v('total') && <TableCell className="text-right font-mono">{hours(data.totalMinutes)}</TableCell>}
                {v('amount') && <TableCell className="text-right">{formatMoney(data.totalAmount)}</TableCell>}
              </TableRow>
            </TableFooter>
          )}
        </Table>
        <TablePagination state={pg} total={data?.total} unit="nhân viên" />
      </div>
    </div>
  );
}

function LeavePayoutTab() {
  const pg = usePageState('report-leave-payout');
  const { data, isLoading } = useLeavePayoutPage(pg.query);
  const rows = data?.items ?? [];
  const due = data?.due ?? [];
  const cols = useColumns('report-leave-payout', PAYOUT_COLUMNS);
  const v = cols.show;
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Phép năm chưa dùng được quy ra tiền <b>khi nghỉ việc</b> (Điều 113 BLLĐ): ngày còn lại × lương ngày (lương HĐ ÷ công chuẩn tháng nghỉ việc).
          Người đang làm hiện giá trị ước tính.
        </p>
        <div className="flex gap-2"><ColumnsMenu state={cols} className="h-9" /><ExcelButton url={excelUrl.leavePayout()} /></div>
      </div>
      {due.length > 0 && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle className="text-base">Cần thanh toán khi nghỉ việc ({due.length})</CardTitle>
            <CardDescription>Nhân viên đã nghỉ trong năm nay còn phép chưa dùng.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {due.map((r) => (
              <div key={r.employee.id} className="flex flex-wrap justify-between gap-2">
                <span>{r.employee.fullName} · nghỉ {r.employee.leftAt ? formatDate(r.employee.leftAt) : ''} · còn {days(r.available)} ngày</span>
                <b>{formatMoney(r.payoutAmount)}</b>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nhân viên</TableHead>
              {v('accrued') && <TableHead className="text-right">Tích luỹ năm nay</TableHead>}
              {v('carried') && <TableHead className="text-right">Năm trước chuyển</TableHead>}
              {v('used') && <TableHead className="text-right">Đã dùng</TableHead>}
              {v('pending') && <TableHead className="text-right">Chờ duyệt</TableHead>}
              {v('available') && <TableHead className="text-right">Còn lại</TableHead>}
              {v('daily') && <TableHead className="text-right">Lương ngày</TableHead>}
              {v('payout') && <TableHead className="text-right">Tiền phép</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={cols.span()}><Spinner /></TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.employee.id} className={r.employee.isActive ? undefined : 'text-muted-foreground'}>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}
                  {!r.employee.isActive && <StatusBadge tone="muted" className="ml-2">Đã nghỉ</StatusBadge>}
                  <div><Warn text={r.warning} /></div>
                </TableCell>
                {v('accrued') && <TableCell className="text-right">{days(r.accrued)}</TableCell>}
                {v('carried') && <TableCell className="text-right">{days(r.carried)}</TableCell>}
                {v('used') && <TableCell className="text-right">{days(r.used)}</TableCell>}
                {v('pending') && <TableCell className="text-right">{days(r.pending)}</TableCell>}
                {v('available') && <TableCell className="text-right font-medium">{days(r.available)}</TableCell>}
                {v('daily') && <TableCell className="text-right">{formatMoney(r.dailyWage)}</TableCell>}
                {v('payout') && (
                  <TableCell className="text-right">
                    {formatMoney(r.payoutAmount)}
                    <div className="text-xs text-muted-foreground">{r.payoutDue ? 'phải trả' : 'ước tính'}</div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="nhân viên" />
      </div>
    </div>
  );
}

/** Báo cáo (HR): bảng công tháng, tiền tăng ca, phép năm — xem trên web và xuất Excel. */
export function ReportsPage() {
  const [tab, setTab] = useTabParam('timesheet', ['timesheet', 'overtime', 'leave']);
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Báo cáo" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="timesheet">Bảng công</TabsTrigger>
          <TabsTrigger value="overtime">Tiền tăng ca</TabsTrigger>
          <TabsTrigger value="leave">Phép năm</TabsTrigger>
        </TabsList>
        <TabsContent value="timesheet" className="pt-2"><TimesheetTab /></TabsContent>
        <TabsContent value="overtime" className="pt-2"><OvertimePayTab /></TabsContent>
        <TabsContent value="leave" className="pt-2"><LeavePayoutTab /></TabsContent>
      </Tabs>
    </div>
  );
}
