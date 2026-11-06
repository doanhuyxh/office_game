import { PageHeader } from '@/components/layout/PageHeader';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/common/button';
import { downloadUrl } from '@/utils/money';
import { useState } from 'react';
import { Input } from '@/components/common/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { hasRole, useMe } from '@/features/auth';
import { useMyCorrections, useMyMonth, useToday } from '../hooks/useAttendance';
import type { IDay } from '../types/attendance.types';
import { CorrectionDialog } from './CorrectionDialog';
import { currentMonth } from '../utils/labels';
import { CheckInCard } from './CheckInCard';
import { HolidaysPanel } from './HolidaysPanel';
import { MonthTimesheet } from './MonthTimesheet';
import { OvertimeTab } from './OvertimeTab';
import { SchedulesPanel } from './SchedulesPanel';
import { ShiftsPanel } from './ShiftsPanel';
import { BoardTable, ReportTable } from './TeamTables';

function MonthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="w-44" aria-label="Chọn tháng" />;
}

function MyTab() {
  const [month, setMonth] = useState(currentMonth());
  const { noProfile } = useToday();
  const { data } = useMyMonth(month);
  const { data: corrections = [] } = useMyCorrections(month);
  const [correcting, setCorrecting] = useState<IDay | null>(null);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <CheckInCard className="h-fit" />
      {!noProfile && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Bảng công của tôi</h3>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          {data ? <MonthTimesheet data={data} onCorrect={setCorrecting} corrections={corrections} /> : <p className="text-sm text-muted-foreground">Đang tải…</p>}
          <CorrectionDialog day={correcting} onClose={() => setCorrecting(null)} />
        </div>
      )}
    </div>
  );
}

/** Màn hình Chấm công: của tôi · hôm nay (quản lý/HR) · tổng hợp tháng (quản lý/HR) · ca & lịch (HR). */
export function AttendancePage() {
  const { data: me } = useMe();
  const isManager = hasRole(me, 'admin', 'hr', 'manager');
  const isHr = hasRole(me, 'admin', 'hr');
  const { noProfile } = useToday();
  const [month, setMonth] = useState(currentMonth());
  return (
    <div className="space-y-6">
      <PageHeader title="Chấm công" description="Bấm chấm công khi bắt đầu và kết thúc làm việc — ở văn phòng hay ở nhà đều được." />
      <Tabs defaultValue="my">
        <TabsList>
          <TabsTrigger value="my">Của tôi</TabsTrigger>
          {!noProfile && <TabsTrigger value="overtime">Tăng ca</TabsTrigger>}
          {isManager && <TabsTrigger value="board">Hôm nay</TabsTrigger>}
          {isManager && <TabsTrigger value="report">Tổng hợp tháng</TabsTrigger>}
          {isHr && <TabsTrigger value="settings">Ca &amp; lịch</TabsTrigger>}
        </TabsList>
        <TabsContent value="my" className="mt-4"><MyTab /></TabsContent>
        {!noProfile && <TabsContent value="overtime" className="mt-4"><OvertimeTab /></TabsContent>}
        {isManager && <TabsContent value="board" className="mt-4"><BoardTable /></TabsContent>}
        {isManager && (
          <TabsContent value="report" className="mt-4 space-y-3">
            <div className="flex justify-end gap-2">
              <MonthPicker value={month} onChange={setMonth} />
              {/* Excel: HR mọi người, quản lý bản thân + cấp dưới (back-end lọc) */}
              <Button variant="outline" onClick={() => downloadUrl(`/api/reports/timesheet.xlsx?month=${month}`)}>
                <FileSpreadsheet className="size-4" /> Xuất Excel
              </Button>
            </div>
            <ReportTable month={month} />
          </TabsContent>
        )}
        {isHr && (
          <TabsContent value="settings" className="mt-4 space-y-8">
            <ShiftsPanel />
            <SchedulesPanel />
            <HolidaysPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
