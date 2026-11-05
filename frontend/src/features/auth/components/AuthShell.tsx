import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-slate-900 to-blue-900 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="text-4xl">🏢</div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
