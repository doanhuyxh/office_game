import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { CheckInCard } from '@/features/attendance';
import { useMe } from '@/features/auth';
import { PATHS } from '@/config/paths';

export function Dashboard() {
  const { data: me } = useMe();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Xin chào, {me?.fullName} 👋</h1>
      <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
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
              <CardTitle className="text-lg">—</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Module Nghỉ phép đang phát triển</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Đơn chờ duyệt</CardDescription>
              <CardTitle className="text-lg">—</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">Module Phê duyệt đang phát triển</CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
