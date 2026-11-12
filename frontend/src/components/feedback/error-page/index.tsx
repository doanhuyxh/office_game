import { useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/common/button';
import { PATHS } from '@/config/paths';
import { cn } from '@/utils/cn';
import { formatTime, todayVn } from '@/utils/date';
import { isChunkLoadError, reloadOnceForChunkError } from '@/utils/chunk-reload';

/**
 * Trang lỗi chung (TEST-67) thay cho "Something went wrong!" của TanStack Router: tiếng Việt, theo theme, có Tải lại / Về trang chủ.
 * KHÔNG hiện stack trace / thông báo lỗi thô — chỉ ghi console.error và hiện mã lỗi ngắn (thời điểm + đường dẫn) để báo admin.
 * Lỗi tải chunk sau deploy → tự tải lại một lần (utils/chunk-reload.ts), lần sau vẫn lỗi → "Hệ thống vừa được cập nhật".
 * `fullScreen`: lỗi ngoài khung trang (root router, error boundary gốc ở main.tsx); trong khung trang (route main) giữ sidebar / header.
 * Dùng thẻ <a> / location thay Link: boundary gốc nằm ngoài router.
 */
export function ErrorPage({ error, fullScreen = false }: { error: unknown; fullScreen?: boolean }) {
  const chunk = isChunkLoadError(error);
  const [code] = useState(() => `${todayVn().replaceAll('-', '')}-${formatTime(new Date()).replace(':', '')} · ${location.pathname}`);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    console.error(`[OfficeHub] Lỗi giao diện (${code})`, error);
    if (chunk && reloadOnceForChunkError()) setReloading(true);
  }, [error, chunk, code]);

  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-3 px-4 text-center', fullScreen ? 'min-h-svh bg-background text-foreground' : 'py-24')}
      role="alert"
      data-testid="error-page"
    >
      <h1 className="sr-only">Đã xảy ra lỗi</h1>
      {chunk ? <RefreshCw className={cn('size-12 text-muted-foreground', reloading && 'animate-spin')} /> : <TriangleAlert className="size-12 text-warning" />}
      <div className="text-lg font-semibold">{chunk ? 'Hệ thống vừa được cập nhật' : 'Đã xảy ra lỗi khi hiển thị trang này'}</div>
      <p className="max-w-md text-sm text-muted-foreground">
        {chunk
          ? reloading ? 'Đang tải phiên bản mới…' : 'Vui lòng tải lại trang để dùng phiên bản mới nhất.'
          : 'Bạn thử tải lại trang. Nếu vẫn lỗi, gửi mã lỗi bên dưới cho quản trị viên.'}
      </p>
      {!chunk && <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground select-all">{code}</code>}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button onClick={() => location.reload()} disabled={reloading}><RefreshCw /> Tải lại trang</Button>
        <Button asChild variant="outline"><a href={PATHS.dashboard}>Về trang chủ</a></Button>
      </div>
    </div>
  );
}
