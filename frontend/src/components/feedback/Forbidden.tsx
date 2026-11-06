import { Link } from '@tanstack/react-router';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/common/button';
import { PATHS } from '@/config/paths';

/** Trang "không có quyền" — khi gõ thẳng URL một trang không dành cho vai trò của mình (xem config/access.ts). */
export function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center" data-testid="forbidden">
      <h1 className="sr-only">Không có quyền</h1>
      <ShieldX className="size-12 text-muted-foreground" />
      <div className="text-lg font-semibold">Bạn không có quyền xem trang này</div>
      <p className="max-w-sm text-sm text-muted-foreground">Trang này chỉ dành cho HR / quản trị. Nếu bạn cần quyền truy cập, liên hệ bộ phận Nhân sự.</p>
      <Button asChild variant="outline"><Link to={PATHS.dashboard}>Về Tổng quan</Link></Button>
    </div>
  );
}
