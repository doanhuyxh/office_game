import { useState } from 'react';
import { AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Input } from '@/components/common/input';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { ReportTable } from '@/features/attendance';
import { currentMonthVn, formatDate } from '@/utils/date';
import { downloadUrl, formatMoney } from '@/utils/money';
import { excelUrl } from '../api/report.api';
import { useLeavePayout, useOvertimePay } from '../hooks/useReports';
import { days, hours } from '../utils/labels';

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

function OvertimePayTab() {
  const [month, setMonth] = useState(currentMonthVn);
  const { data, isLoading } = useOvertimePay(month);
  const rows = data?.rows.filter((r) => r.totalMinutes > 0) ?? [];
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Chỉ đơn tăng ca <b>đã duyệt</b>. Lương giờ = lương hợp đồng ÷ ngày công chuẩn của tháng ÷ 8 (không gồm phụ cấp); ngày công chuẩn tính cả ngày lễ.
        </p>
        <div className="flex gap-2"><MonthPicker value={month} onChange={setMonth} /><ExcelButton url={excelUrl.overtimePay(month)} /></div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nhân viên</TableHead>
              <TableHead className="text-right">Lương HĐ</TableHead>
              <TableHead className="text-right">Công chuẩn</TableHead>
              <TableHead className="text-right">Lương giờ</TableHead>
              <TableHead className="text-right">150%</TableHead>
              <TableHead className="text-right">200%</TableHead>
              <TableHead className="text-right">300%</TableHead>
              <TableHead className="text-right">Tổng giờ</TableHead>
              <TableHead className="text-right">Thành tiền</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={9}><Spinner /></TableCell></TableRow>}
            {!isLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Không có tăng ca đã duyệt trong tháng.</TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.employee.id}>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}
                  <div><Warn text={r.warning} /></div>
                </TableCell>
                <TableCell className="text-right">{formatMoney(r.salary)}</TableCell>
                <TableCell className="text-right">{r.standardDays}</TableCell>
                <TableCell className="text-right">{formatMoney(r.hourlyWage)}</TableCell>
                <TableCell className="text-right font-mono">{hours(r.weekdayMinutes)}</TableCell>
                <TableCell className="text-right font-mono">{hours(r.restDayMinutes)}</TableCell>
                <TableCell className="text-right font-mono">{hours(r.holidayMinutes)}</TableCell>
                <TableCell className="text-right font-mono">{hours(r.totalMinutes)}</TableCell>
                <TableCell className="text-right font-medium">{formatMoney(r.totalAmount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {rows.length > 0 && data && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={7}>Tổng tháng {month.slice(5)}/{month.slice(0, 4)}</TableCell>
                <TableCell className="text-right font-mono">{hours(data.totalMinutes)}</TableCell>
                <TableCell className="text-right">{formatMoney(data.totalAmount)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}

function LeavePayoutTab() {
  const { data: rows = [], isLoading } = useLeavePayout();
  const due = rows.filter((r) => r.payoutDue);
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Phép năm chưa dùng được quy ra tiền <b>khi nghỉ việc</b> (Điều 113 BLLĐ): ngày còn lại × lương ngày (lương HĐ ÷ công chuẩn tháng nghỉ việc).
          Người đang làm hiện giá trị ước tính.
        </p>
        <ExcelButton url={excelUrl.leavePayout()} />
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
              <TableHead className="text-right">Tích luỹ năm nay</TableHead>
              <TableHead className="text-right">Năm trước chuyển</TableHead>
              <TableHead className="text-right">Đã dùng</TableHead>
              <TableHead className="text-right">Chờ duyệt</TableHead>
              <TableHead className="text-right">Còn lại</TableHead>
              <TableHead className="text-right">Lương ngày</TableHead>
              <TableHead className="text-right">Tiền phép</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={8}><Spinner /></TableCell></TableRow>}
            {rows.map((r) => (
              <TableRow key={r.employee.id} className={r.employee.isActive ? undefined : 'text-muted-foreground'}>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{r.employee.code}</span> {r.employee.fullName}
                  {!r.employee.isActive && <StatusBadge tone="muted" className="ml-2">Đã nghỉ</StatusBadge>}
                  <div><Warn text={r.warning} /></div>
                </TableCell>
                <TableCell className="text-right">{days(r.accrued)}</TableCell>
                <TableCell className="text-right">{days(r.carried)}</TableCell>
                <TableCell className="text-right">{days(r.used)}</TableCell>
                <TableCell className="text-right">{days(r.pending)}</TableCell>
                <TableCell className="text-right font-medium">{days(r.available)}</TableCell>
                <TableCell className="text-right">{formatMoney(r.dailyWage)}</TableCell>
                <TableCell className="text-right">
                  {formatMoney(r.payoutAmount)}
                  <div className="text-xs text-muted-foreground">{r.payoutDue ? 'phải trả' : 'ước tính'}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Báo cáo (HR): bảng công tháng, tiền tăng ca, phép năm — xem trên web và xuất Excel. */
export function ReportsPage() {
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Báo cáo" description="Bảng công, tiền tăng ca và phép năm theo tháng — xuất Excel để làm lương." />
      <Tabs defaultValue="timesheet">
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
