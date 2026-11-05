import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/common/card';

/** Trang giữ chỗ cho module chưa triển khai. */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-4">
      <PageHeader title={title} />
      <Card>
        <CardHeader>
          <CardTitle>Chưa triển khai</CardTitle>
          <CardDescription>{phase}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
