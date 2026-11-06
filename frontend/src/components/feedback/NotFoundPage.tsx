import { Link } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/common/button';
import { PATHS } from '@/config/paths';

/** 404 trong khung trang (MainLayout). */
export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h1 className="sr-only">Không tìm thấy trang</h1>
      <SearchX className="size-12 text-muted-foreground" />
      <div className="text-lg font-semibold">Không tìm thấy trang</div>
      <p className="text-sm text-muted-foreground">Đường dẫn không tồn tại hoặc đã đổi.</p>
      <Button asChild variant="outline"><Link to={PATHS.dashboard}>Về Tổng quan</Link></Button>
    </div>
  );
}
