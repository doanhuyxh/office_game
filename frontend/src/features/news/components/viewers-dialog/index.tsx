import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { useViewers } from '../../hooks/useNews';

/** Ai đã xem bài (chỉ tác giả + HR — server trả 404 cho người khác). */
export function ViewersDialog({ postId, open, onOpenChange }: { postId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useViewers(postId, open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Người đã xem</DialogTitle>
          <DialogDescription>
            {q.data ? `${q.data.count}${q.data.audienceCount ? ` / ${q.data.audienceCount}` : ''} người đã xem bài này (chỉ bạn và HR thấy danh sách).` : 'Đang tải…'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto" data-testid="viewer-list">
          {q.isLoading && <Spinner />}
          {q.isError && <p className="py-6 text-center text-sm text-muted-foreground">Không tải được danh sách.</p>}
          {q.data?.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Chưa có ai xem.</p>}
          {q.data?.items.map((v) => (
            <div key={v.userId} className="flex items-center gap-3 rounded-lg p-2">
              <PersonAvatar name={v.name} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{v.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{[v.code, v.departmentName].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(v.viewedAt)}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
