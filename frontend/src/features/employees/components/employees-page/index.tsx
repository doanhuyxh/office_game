import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/common/button';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { hasRole, useMe } from '@/features/auth';
import { DepartmentsPanel } from '../departments-panel';
import { EmployeeTable } from '../employee-table';
import { ImportDialog } from '../import-dialog';
import { OrgChart } from '../org-chart';
import { PositionsPanel } from '../positions-panel';
import { ProfileRequestsPanel, usePendingProfileRequestCount } from '@/features/profile';
import { useTabParam } from '@/hooks/useTabParam';

/** Màn hình Nhân sự: danh sách nhân viên, phòng ban, chức vụ. Chỉ admin/HR được sửa. */
export function EmployeesPage() {
  const { data: me } = useMe();
  const canEdit = hasRole(me, 'admin', 'hr');
  const [importing, setImporting] = useState(false);
  const pending = usePendingProfileRequestCount(canEdit);
  const [tab, setTab] = useTabParam('employees', ['employees', 'departments', 'positions', ...(canEdit ? ['chart', 'requests'] : [])]);
  return (
    <div className="space-y-6">
      <PageHeader title="Nhân viên" />
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar actions={canEdit && <Button variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet className="size-4" /> Nhập từ Excel</Button>}>
        <TabsList>
          <TabsTrigger value="employees">Nhân viên</TabsTrigger>
          <TabsTrigger value="departments">Phòng ban</TabsTrigger>
          <TabsTrigger value="positions">Chức vụ</TabsTrigger>
          {canEdit && <TabsTrigger value="chart">Sơ đồ tổ chức</TabsTrigger>}
          {canEdit && <TabsTrigger value="requests">Yêu cầu cập nhật{pending > 0 && <span className="ms-1 rounded-full bg-destructive px-1.5 text-[10px] text-white" data-testid="requests-badge">{pending}</span>}</TabsTrigger>}
        </TabsList>
        </PageToolbar>
        <TabsContent value="employees" className="mt-4"><EmployeeTable canEdit={canEdit} /></TabsContent>
        <TabsContent value="departments" className="mt-4"><DepartmentsPanel canEdit={canEdit} /></TabsContent>
        <TabsContent value="positions" className="mt-4"><PositionsPanel canEdit={canEdit} /></TabsContent>
        {canEdit && <TabsContent value="chart" className="mt-4"><OrgChart /></TabsContent>}
        {canEdit && <TabsContent value="requests" className="mt-4"><ProfileRequestsPanel /></TabsContent>}
      </Tabs>
      {canEdit && <ImportDialog open={importing} onOpenChange={setImporting} />}
    </div>
  );
}
