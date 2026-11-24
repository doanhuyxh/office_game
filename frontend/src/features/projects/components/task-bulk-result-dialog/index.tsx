import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import type { IBulkTasksResult } from '../../types/project.types';

/** Kết quả thao tác hàng loạt khi có việc bị bỏ qua: số việc đã làm + danh sách việc bỏ qua kèm lý do (việc đó vẫn được giữ chọn). */
export function TaskBulkResultDialog({ result, label, onClose }: { result: IBulkTasksResult | null; label: string; onClose: () => void }) {
  if (!result) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-result">
        <DialogHeader>
          <DialogTitle>{label}: đã làm {result.applied.length} việc, bỏ qua {result.skipped.length} việc</DialogTitle>
          <DialogDescription>Các việc bị bỏ qua không đổi gì và vẫn đang được chọn để bạn xử lý tiếp.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-72 overflow-y-auto rounded-lg border px-3 py-2 text-sm" data-testid="bulk-skipped">
          {result.skipped.map((s) => <li key={s.taskId} className="py-0.5"><span className="font-medium">{s.code}</span>: <span className="text-muted-foreground">{s.reason}</span></li>)}
        </ul>
        <DialogFooter><Button onClick={onClose}>Đóng</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
