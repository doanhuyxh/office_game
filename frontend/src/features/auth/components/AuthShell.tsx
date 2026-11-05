import type { ReactNode } from 'react';
import { Building2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';

/** Khung các màn đăng nhập / đặt mật khẩu: logo + thẻ ở giữa trang (bố cục theo shadcn-admin). */
export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh items-center justify-center px-4">
      <div className="mx-auto flex w-full flex-col justify-center gap-2 py-8 sm:w-[400px] sm:p-8">
        <div className="mb-4 flex items-center justify-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="size-4" />
          </div>
          <span className="text-xl font-medium">OfficeHub</span>
        </div>
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-lg tracking-tight">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
