import { formatNumber } from '@/utils/number';
import { PageHeader } from '@/components/layout/PageHeader';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { useInboxCount } from '@/features/approvals';
import { CheckInCard } from '@/features/attendance';
import { useMyBalance } from '@/features/leave';
import { MyRoleCard } from '@/features/employees';
import { PATHS } from '@/config/paths';

export function Dashboard() {
  const { data: balance } = useMyBalance();
  const { data: inbox = 0 } = useInboxCount();
  return (
    <div className="space-y-6">
      <PageHeader title="Tổng quan" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <CheckInCard />
        <div className="grid h-fit gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Văn phòng 3D</CardDescription>
              <CardTitle className="text-lg">Gặp đồng nghiệp</CardTitle>
            </CardHeader>
            <CardContent>
              <Link to={PATHS.office} className="text-sm text-primary hover:underline">Vào văn phòng →</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Bảng công</CardDescription>
              <CardTitle className="text-lg">Tháng này</CardTitle>
            </CardHeader>
            <CardContent>
              <Link to={PATHS.attendance} className="text-sm text-primary hover:underline">Xem chi tiết →</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Phép năm còn lại</CardDescription>
              <CardTitle className="text-lg">{balance ? `${formatNumber(balance.available)} ngày` : '—'}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link to={PATHS.leave} className="text-sm text-primary hover:underline">Xin nghỉ →</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Đơn chờ tôi duyệt</CardDescription>
              <CardTitle className="text-lg">{inbox}</CardTitle>
            </CardHeader>
            <CardContent>
              <Link to={PATHS.approvals} className="text-sm text-primary hover:underline">Xem đơn →</Link>
            </CardContent>
          </Card>
        </div>
      </div>
      <MyRoleCard />
    </div>
  );
}
