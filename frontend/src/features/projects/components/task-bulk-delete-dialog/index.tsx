import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { errorMessage } from '@/utils/errors';
import { useBulkTasks } from '../../hooks/useProjects';
import type { IBulkTasksResult, ITask } from '../../types/project.types';
import { BULK_DELETE_WORD, isDeleteConfirmed } from '../../utils/task-bulk';

/**
 * Xoá hàng loạt việc. Cảnh báo không hoàn tác + BẮT GÕ TAY chữ "delete" mới bấm xoá được (chống thao tác nhầm; back-end kiểm lại `confirm`).
 * Quyền xoá vẫn tính từng việc (người tạo việc hoặc quản lý dự án) — việc không đủ quyền được bỏ qua và báo lý do.
 */
export function TaskBulkDeleteDialog({ projectId, tasks, open, onClose, onResult }: {
  projectId: string; tasks: ITask[]; open: boolean; onClose: () => void; onResult: (r: IBulkTasksResult) => void;
}) {
  const bulk = useBulkTasks(projectId);
  const [typed, setTyped] = useState('');
  useEffect(() => { if (open) setTyped(''); }, [open]);
  const ok = isDeleteConfirmed(typed);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !bulk.isPending) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-delete-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-5" /> Xoá {tasks.length} công việc?</DialogTitle>
          <DialogDescription>
            Việc biến mất khỏi dự án của mọi người, kèm toàn bộ bình luận, tệp đính kèm và lịch sử. <b>Không thể hoàn tác.</b>
            {' '}Chỉ người tạo việc hoặc quản lý dự án xoá được — việc không đủ quyền sẽ được bỏ qua.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-44 overflow-y-auto rounded-lg border px-3 py-2 text-sm" data-testid="bulk-delete-list">
          {tasks.map((t) => <li key={t.id} className="truncate"><span className="font-mono text-xs text-muted-foreground">{t.code}</span> {t.title}</li>)}
        </ul>
        <div className="grid gap-2">
          <Label htmlFor="bulk-delete-confirm">Gõ <b className="font-mono text-destructive">{BULK_DELETE_WORD}</b> để xác nhận xoá</Label>
          <Input id="bulk-delete-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={BULK_DELETE_WORD} data-testid="bulk-delete-input" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { if (!bulk.isPending) onClose(); }}>Huỷ</Button>
          <Button variant="destructive" loading={bulk.isPending} loadingText="Đang xoá…" disabled={!ok || tasks.length === 0} data-testid="bulk-delete-confirm"
            onClick={() => bulk.mutate({ taskIds: tasks.map((t) => t.id), action: 'delete', confirm: typed.trim() }, {
              onSuccess: (r) => { onResult(r); onClose(); },
              onError: (err) => toast.error(errorMessage(err, 'Không xoá được')),
            })}>
            Xoá {tasks.length} việc
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
