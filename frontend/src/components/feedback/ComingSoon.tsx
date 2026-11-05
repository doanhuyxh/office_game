import { Card, CardDescription, CardHeader, CardTitle } from '@/components/common/card';

/** Trang giữ chỗ cho module chưa triển khai. */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Chưa triển khai</CardTitle>
          <CardDescription>{phase}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
