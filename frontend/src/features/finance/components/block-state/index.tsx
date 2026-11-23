import { RotateCw } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Skeleton } from '@/components/common/skeleton';
import { errorMessage } from '@/utils/errors';

/**
 * Trạng thái của một khối trên Tổng quan / Dự báo: đang tải (skeleton) · lỗi (thông báo + Thử lại) · rỗng.
 * Mỗi khối tự xử lý → một API lỗi không làm trắng cả tab.
 */
export function BlockState({ loading, error, onRetry, retrying, empty, rows = 3 }: {
  loading?: boolean; error?: unknown; onRetry?: () => void; retrying?: boolean; empty?: string; rows?: number;
}) {
  if (loading) {
    return (
      <div className="grid gap-2 p-4" aria-busy="true" aria-label="Đang tải">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-5 w-full" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2 p-4 text-sm text-destructive" role="alert">
        <span>Không tải được: {errorMessage(error)}</span>
        {onRetry && <Button size="sm" variant="outline" loading={retrying} loadingText="Đang tải…" onClick={onRetry}><RotateCw /> Thử lại</Button>}
      </div>
    );
  }
  return empty ? <div className="p-6 text-center text-sm text-muted-foreground">{empty}</div> : null;
}
