import { PageHeader } from '@/components/layout/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { hasRole, useMe } from '@/features/auth';
import { DepartmentsPanel } from './DepartmentsPanel';
import { EmployeeTable } from './EmployeeTable';
import { PositionsPanel } from './PositionsPanel';

/** Màn hình Nhân sự: danh sách nhân viên, phòng ban, chức vụ. Chỉ admin/HR được sửa. */
export function EmployeesPage() {
  const { data: me } = useMe();
  const canEdit = hasRole(me, 'admin', 'hr');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nhân viên"
        description={canEdit ? 'Quản lý hồ sơ, phòng ban, chức vụ và tài khoản đăng nhập.' : 'Danh bạ nhân viên trong công ty.'}
      />
      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Nhân viên</TabsTrigger>
          <TabsTrigger value="departments">Phòng ban</TabsTrigger>
          <TabsTrigger value="positions">Chức vụ</TabsTrigger>
        </TabsList>
        <TabsContent value="employees" className="mt-4"><EmployeeTable canEdit={canEdit} /></TabsContent>
        <TabsContent value="departments" className="mt-4"><DepartmentsPanel canEdit={canEdit} /></TabsContent>
        <TabsContent value="positions" className="mt-4"><PositionsPanel canEdit={canEdit} /></TabsContent>
      </Tabs>
    </div>
  );
}
