import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { RadioGroup, RadioGroupItem } from '@/components/common/radio-group';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { errorMessage } from '@/utils/errors';
import { useBulkTasks } from '../../hooks/useProjects';
import type { BulkDueMode, IBulkTasksRequest, IBulkTasksResult, IMember, ITask, ITaskColumn } from '../../types/project.types';
import { BULK_MAX_SHIFT, movePlan, withoutDue } from '../../utils/task-bulk';

export type BulkEditKind = 'move' | 'assign' | 'due' | 'follow' | 'unfollow';

const TITLE: Record<BulkEditKind, string> = {
  move: 'Chuyển trạng thái', assign: 'Giao cho người khác', due: 'Đổi hạn', follow: 'Thêm người theo dõi', unfollow: 'Bỏ người theo dõi',
};

/**
 * Hộp thoại thao tác hàng loạt (trừ xoá — `TaskBulkDeleteDialog`): chuyển trạng thái / giao người / đổi hạn / thêm – bỏ người theo dõi cho các việc đang chọn.
 * Xem trước ở FE (cùng `moveBlockReason` với kanban) cho biết việc nào sẽ bị bỏ qua; back-end vẫn kiểm từng việc, thành công từng phần —
 * kết quả trả về cho `onResult` (hộp liệt kê việc bị bỏ qua nằm ở `TaskBulkBar`).
 */
export function TaskBulkDialog({ projectId, kind, tasks, columns, members, sequential, canApprove, onClose, onResult }: {
  projectId: string; kind: BulkEditKind | null; tasks: ITask[]; columns: ITaskColumn[]; members: IMember[]; sequential: boolean; canApprove: boolean;
  onClose: () => void; onResult: (r: IBulkTasksResult, kind: BulkEditKind) => void;
}) {
  const bulk = useBulkTasks(projectId);
  const [columnId, setColumnId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const [mode, setMode] = useState<BulkDueMode>('set');
  const [dueOn, setDueOn] = useState('');
  const [shift, setShift] = useState('7');
  useEffect(() => { if (kind) { setColumnId(null); setNote(''); setPerson(null); setMode('set'); setDueOn(''); setShift('7'); } }, [kind]);
  if (!kind) return null;

  const people = members.filter((m) => m.isActive).map((m) => ({ value: m.employeeId, label: m.fullName }));
  const column = columns.find((c) => c.id === columnId);
  const plan = movePlan(tasks, column, columns, sequential, canApprove);
  const shiftN = Number(shift);
  const shiftOk = Number.isInteger(shiftN) && shiftN !== 0 && Math.abs(shiftN) <= BULK_MAX_SHIFT;
  const noDue = withoutDue(tasks).length;

  let body: IBulkTasksRequest | null = null;
  const ids = tasks.map((t) => t.id);
  if (kind === 'move' && column && plan.ok.length > 0 && (!plan.needsNote || note.trim())) body = { taskIds: plan.ok.map((t) => t.id), action: 'move', columnId: column.id, note: note.trim() || null };
  if (kind === 'assign') body = { taskIds: ids, action: 'assign', assigneeEmployeeId: person };
  if (kind === 'due' && (mode === 'clear' || (mode === 'set' && dueOn) || (mode === 'shift' && shiftOk)))
    body = { taskIds: ids, action: 'due', dueMode: mode, dueOn: mode === 'set' ? dueOn : undefined, shiftDays: mode === 'shift' ? shiftN : undefined };
  if ((kind === 'follow' || kind === 'unfollow') && person) body = { taskIds: ids, action: kind, followerEmployeeId: person };
  const count = body?.taskIds.length ?? tasks.length;

  const submit = () => {
    if (!body) return;
    bulk.mutate(body, {
      onSuccess: (r) => { onResult(r, kind); onClose(); },
      onError: (err) => toast.error(errorMessage(err, 'Không thực hiện được thao tác hàng loạt')),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !bulk.isPending) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-dialog" data-kind={kind}>
        <DialogHeader>
          <DialogTitle>{TITLE[kind]} — {tasks.length} việc</DialogTitle>
          <DialogDescription>Mỗi việc đi qua đúng quy tắc như khi làm tay từng việc; việc nào không làm được sẽ được bỏ qua và báo lý do.</DialogDescription>
        </DialogHeader>

        {kind === 'move' && <>
          <SelectField id="bulk-column" label="Chuyển sang trạng thái" value={columnId} onChange={setColumnId} placeholder="Chọn trạng thái"
            options={columns.map((c) => ({ value: c.id, label: c.name }))} />
          {column && <div className="grid gap-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="bulk-move-preview">
            <p><b>{plan.ok.length}</b> việc chuyển được{plan.same.length > 0 && <> · {plan.same.length} việc đã ở "{column.name}"</>}{plan.blocked.length > 0 && <> · <b className="text-destructive">{plan.blocked.length}</b> việc bị bỏ qua</>}</p>
            {plan.blocked.length > 0 && <ul className="max-h-28 overflow-y-auto text-xs text-muted-foreground">
              {plan.blocked.map((b) => <li key={b.task.id}><span className="font-medium">{b.task.code}</span>: {b.reason}</li>)}
            </ul>}
          </div>}
          {plan.needsNote && <div className="grid gap-2">
            <Label htmlFor="bulk-note">Lý do chuyển lùi (thành bình luận của từng việc)</Label>
            <Textarea id="bulk-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} data-testid="bulk-note" />
          </div>}
        </>}

        {kind === 'assign' && <SelectField id="bulk-person" label="Người làm" value={person} onChange={setPerson} allowEmpty emptyLabel="Chưa giao (bỏ người làm)" options={people} />}

        {kind === 'due' && <div className="grid gap-3">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as BulkDueMode)} className="grid gap-2" data-testid="bulk-due-mode">
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="set" /> Đặt cùng một ngày</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="shift" /> Dời hạn hiện có thêm / bớt vài ngày</label>
            <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="clear" /> Xoá hạn</label>
          </RadioGroup>
          {mode === 'set' && <div className="grid gap-2"><Label htmlFor="bulk-due">Hạn</Label>
            <Input id="bulk-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} data-testid="bulk-due" /></div>}
          {mode === 'shift' && <div className="grid gap-2"><Label htmlFor="bulk-shift">Số ngày (số âm = lùi lại, tối đa {BULK_MAX_SHIFT})</Label>
            <Input id="bulk-shift" type="number" inputMode="numeric" value={shift} onChange={(e) => setShift(e.target.value)} data-testid="bulk-shift" />
            {noDue > 0 && <p className="text-xs text-muted-foreground">{noDue} việc chưa có hạn sẽ được bỏ qua.</p>}</div>}
        </div>}

        {(kind === 'follow' || kind === 'unfollow') && <SelectField id="bulk-person" label="Người theo dõi" value={person} onChange={setPerson} placeholder="Chọn thành viên dự án" options={people} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => { if (!bulk.isPending) onClose(); }}>Huỷ</Button>
          <Button loading={bulk.isPending} loadingText="Đang áp dụng…" disabled={!body} onClick={submit} data-testid="bulk-apply">Áp dụng cho {count} việc</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
