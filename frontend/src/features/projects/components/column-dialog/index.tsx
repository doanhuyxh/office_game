import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation } from '../../hooks/useProjects';
import type { ITaskColumn, ITaskColumnRequest } from '../../types/project.types';
import { COLUMN_PALETTE } from '../../utils/labels';

/**
 * Thêm / sửa / xoá một trạng thái (cột) công việc — chỉ hiện với chức vụ có quyền "Quản lý trạng thái công việc" (back-end kiểm).
 * `column`: undefined = đóng, null = thêm mới (cuối bảng). Xoá cột còn việc → chọn cột nhận việc.
 */
export function ColumnDialog({ projectId, column, columns, onClose }: {
  projectId: string; column: ITaskColumn | null | undefined; columns: ITaskColumn[]; onClose: () => void;
}) {
  const open = column !== undefined;
  const [f, setF] = useState<ITaskColumnRequest>({ name: '', color: COLUMN_PALETTE[0], isDone: false, approverOnly: false });
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const save = useProjectMutation((b: ITaskColumnRequest): Promise<unknown> => (column ? projectApi.updateColumn(column.id, b) : projectApi.createColumn(projectId, b)));
  const remove = useProjectMutation((a: { id: string; moveTo: string | null }) => projectApi.deleteColumn(a.id, a.moveTo));
  const others = columns.filter((c) => c.id !== column?.id);
  useEffect(() => {
    if (!open) return;
    save.reset(); remove.reset(); setMoveTo(null);
    setF(column ? { name: column.name, color: column.color, isDone: column.isDone, approverOnly: column.approverOnly }
      : { name: '', color: COLUMN_PALETTE[columns.length % COLUMN_PALETTE.length], isDone: false, approverOnly: false });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, column?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ITaskColumnRequest>(k: K, v: ITaskColumnRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  const lastDone = !!column?.isDone && !others.some((c) => c.isDone);
  const del = async () => {
    if (!column) return;
    if (column.taskCount > 0 && !moveTo) { toast.error('Chọn trạng thái để chuyển việc sang trước khi xoá'); return; }
    const target = others.find((c) => c.id === moveTo)?.name;
    if (!(await confirmDialog({ title: `Xoá trạng thái "${column.name}"?`, destructive: true, confirmText: 'Xoá',
      description: column.taskCount > 0 ? `${column.taskCount} việc sẽ chuyển sang "${target}".` : undefined }))) return;
    remove.mutate({ id: column.id, moveTo }, { onSuccess: () => { toast.success('Đã xoá trạng thái'); onClose(); }, onError: (err) => toast.error(errorMessage(err)) });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="column-dialog">
        <DialogHeader><DialogTitle>{column ? `Sửa trạng thái "${column.name}"` : 'Thêm trạng thái'}</DialogTitle></DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, name: f.name.trim() }, {
            onSuccess: () => { toast.success(column ? 'Đã lưu trạng thái' : 'Đã thêm trạng thái'); onClose(); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <FormField id="col-name" label="Tên trạng thái *" required autoFocus maxLength={50} value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name}
            placeholder="vd Thiết kế, QA, Chờ khách duyệt" />
          <div className="grid gap-2">
            <Label>Màu</Label>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Màu trạng thái">
              {COLUMN_PALETTE.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={f.color === c} aria-label={c} onClick={() => set('color', c)}
                  className="grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ backgroundColor: c }}>
                  {f.color === c && <Check className="size-4 text-white" />}
                </button>
              ))}
              <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Màu khác">
                <input type="color" aria-label="Chọn màu khác" className="size-7 cursor-pointer rounded border bg-transparent p-0.5"
                  value={f.color ?? COLUMN_PALETTE[0]} onChange={(e) => set('color', e.target.value)} />
                Khác
              </label>
            </div>
            {errors.color && <p className="text-xs text-destructive">{errors.color}</p>}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={f.isDone} disabled={lastDone} onChange={(e) => set('isDone', e.target.checked)} data-testid="col-done" />
            <span><span className="font-medium">Trạng thái hoàn thành</span>
              <span className="block text-xs text-muted-foreground">
                Việc ở đây tính là xong: không báo quá hạn, tính vào % tiến độ.{lastDone && ' Dự án cần ít nhất một trạng thái hoàn thành.'}
              </span></span>
          </label>
          {errors.isDone && <p className="text-xs text-destructive">{errors.isDone}</p>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={f.approverOnly} onChange={(e) => set('approverOnly', e.target.checked)} data-testid="col-approver" />
            <span><span className="font-medium">Cần người duyệt</span>
              <span className="block text-xs text-muted-foreground">Chỉ quản lý dự án được chuyển việc vào, hoặc trả việc về trạng thái trước.</span></span>
          </label>
          {column && column.taskCount > 0 && others.length > 0 && (
            <div className="rounded-lg border border-dashed p-3">
              <SelectField id="col-move" label={`Khi xoá: chuyển ${column.taskCount} việc sang`} value={moveTo} onChange={setMoveTo}
                options={others.map((c) => ({ value: c.id, label: c.name }))} placeholder="Chọn trạng thái…" />
            </div>
          )}
          <DialogFooter className="items-center">
            {column && <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={remove.isPending || others.length === 0 || lastDone}
              title={lastDone ? 'Không xoá trạng thái hoàn thành cuối cùng' : undefined} onClick={() => void del()}><Trash2 /> Xoá</Button>}
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>{column ? 'Lưu' : 'Thêm'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
