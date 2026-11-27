import type { ReactNode } from 'react';
import { BrandLogo, BrandName } from '@/features/branding';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';

/** Khung các màn đăng nhập / đặt mật khẩu: logo + thẻ ở giữa trang (bố cục theo shadcn-admin). */
export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-svh items-center justify-center px-4">
      <div className="mx-auto flex w-full flex-col justify-center gap-2 py-8 sm:w-[400px] sm:p-8">
        <div className="mb-4 flex items-center justify-center gap-2">
          <BrandLogo />
          <BrandName className="text-xl font-medium" />
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
