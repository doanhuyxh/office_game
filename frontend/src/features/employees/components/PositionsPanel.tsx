import { useEffect, useState } from 'react';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDeletePosition, usePositions, useSavePosition } from '../hooks/useOrg';
import type { IPosition } from '../types/employee.types';
import { GuideDialog, type GuideTarget } from './GuideDialog';

export function PositionsPanel({ canEdit }: { canEdit: boolean }) {
  const { data: positions = [], isLoading } = usePositions();
  const save = useSavePosition();
  const remove = useDeletePosition();
  const [editing, setEditing] = useState<IPosition | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [guide, setGuide] = useState<GuideTarget>(null);
  useEffect(() => {
    if (editing === undefined) return;
    save.reset();
    setName(editing?.name ?? '');
    setLevel(editing ? String(editing.level) : '');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [editing]);
  const errors = fieldErrors(save.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: editing?.id, body: { name, level: Number(level) || 0, sortOrder: editing?.sortOrder ?? 0 } }, {
      onSuccess: () => { toast.success('Đã lưu chức vụ'); setEditing(undefined); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  const onDelete = (p: IPosition) => {
    if (!confirm(`Xoá chức vụ "${p.name}"?`)) return;
    remove.mutate(p.id, { onSuccess: () => toast.success('Đã xoá'), onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Chức vụ là <b>cấp bậc</b> (1 = cao nhất), sắp theo cấp. Công việc cụ thể (Lễ tân, Lập trình viên…) ghi ở <b>chức danh</b> trong hồ sơ nhân viên.</p>
        {canEdit && <Button onClick={() => setEditing(null)}><Plus /> Thêm chức vụ</Button>}
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead className="w-20">Cấp</TableHead><TableHead>Chức vụ</TableHead><TableHead className="text-right">Nhân viên</TableHead><TableHead className="w-32" /></TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && positions.length === 0 && (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Chưa có chức vụ</TableCell></TableRow>
            )}
            {positions.map((p) => (
              <TableRow key={p.id}>
                <TableCell><span className="inline-flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{p.level}</span></TableCell>
                <TableCell><div className="font-medium">{p.name}</div>{p.description && <div className="max-w-md truncate text-xs text-muted-foreground" title={p.description}>{p.description}</div>}</TableCell>
                <TableCell className="text-right">{p.employeeCount}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="icon" aria-label="Mô tả & hướng dẫn" title="Mô tả & hướng dẫn" onClick={() => setGuide({ kind: 'position', id: p.id, name: p.name })}>
                    <BookOpen className={p.hasGuide ? 'text-primary' : undefined} /></Button>
                  {canEdit && <>
                    <Button variant="ghost" size="icon" aria-label="Sửa" onClick={() => setEditing(p)}><Pencil /></Button>
                    <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => onDelete(p)}><Trash2 /></Button>
                  </>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <GuideDialog target={guide} onClose={() => setGuide(null)} />
      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Sửa chức vụ' : 'Thêm chức vụ'}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <FormField id="p-name" label="Tên chức vụ *" required autoFocus value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
            <FormField id="p-level" label="Cấp bậc *" type="number" min={1} max={99} required value={level} onChange={(e) => setLevel(e.target.value)}
              hint={`1 = cao nhất. Hiện có: ${[...new Set(positions.map((p) => p.level))].map((l) => `${l} ${positions.filter((p) => p.level === l).map((p) => p.name).join('/')}`).join(' · ')}`}
              error={errors.level} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>Huỷ</Button>
              <Button type="submit" disabled={save.isPending}>Lưu</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
