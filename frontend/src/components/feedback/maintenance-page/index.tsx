import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Wrench } from 'lucide-react';
import { Button } from '@/components/common/button';
import { checkApiHealth, maintenance } from '@/services/maintenance';

const RETRY_SECONDS = 20;

/**
 * Trang bảo trì phủ toàn màn hình (TEST-67) khi API không phản hồi (502 / 503 / 504 từ proxy, lỗi mạng liên tiếp) — App.tsx hiện theo
 * `useApiDown()`. Tự gọi `/health` mỗi 20 giây; API chạy lại → `maintenance.ok()` → App tắt trang này và tải lại dữ liệu.
 */
export function MaintenancePage() {
  const [left, setLeft] = useState(RETRY_SECONDS);
  const [checking, setChecking] = useState(false);

  const retry = useCallback(async () => {
    setChecking(true);
    const up = await checkApiHealth();
    setChecking(false);
    setLeft(RETRY_SECONDS);
    if (up) maintenance.ok();
  }, []);

  useEffect(() => {
    if (checking) return;
    if (left <= 0) { void retry(); return; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, checking, retry]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background px-4 text-center text-foreground"
      role="alertdialog"
      aria-labelledby="maintenance-title"
      data-testid="maintenance-page"
    >
      <Wrench className="size-12 text-muted-foreground" />
      <h1 id="maintenance-title" className="text-lg font-semibold">Hệ thống đang bảo trì</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        OfficeHub đang được cập nhật hoặc khởi động lại, vui lòng thử lại sau ít phút. Dữ liệu bạn đang nhập chưa gửi có thể cần nhập lại.
      </p>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {checking ? 'Đang kiểm tra…' : `Tự thử lại sau ${left} giây`}
      </p>
      <Button className="mt-2" onClick={() => void retry()} disabled={checking}>
        <RefreshCw className={checking ? 'animate-spin' : ''} /> Thử lại
      </Button>
    </div>
  );
}
