import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDeletePosition, usePositions, useSavePosition } from '../hooks/useOrg';
import type { IPosition } from '../types/employee.types';

export function PositionsPanel({ canEdit }: { canEdit: boolean }) {
  const { data: positions = [], isLoading } = usePositions();
  const save = useSavePosition();
  const remove = useDeletePosition();
  const [editing, setEditing] = useState<IPosition | null | undefined>(undefined);
  const [name, setName] = useState('');
  useEffect(() => { if (editing !== undefined) { save.reset(); setName(editing?.name ?? ''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [editing]);
  const errors = fieldErrors(save.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: editing?.id, body: { name, sortOrder: editing?.sortOrder ?? positions.length } }, {
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
      {canEdit && <div className="flex justify-end"><Button onClick={() => setEditing(null)}><Plus /> Thêm chức vụ</Button></div>}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Chức vụ</TableHead><TableHead className="text-right">Nhân viên</TableHead>{canEdit && <TableHead className="w-24" />}</TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && positions.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Chưa có chức vụ</TableCell></TableRow>
            )}
            {positions.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right">{p.employeeCount}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label="Sửa" onClick={() => setEditing(p)}><Pencil /></Button>
                    <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => onDelete(p)}><Trash2 /></Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Sửa chức vụ' : 'Thêm chức vụ'}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <FormField id="p-name" label="Tên chức vụ *" required autoFocus value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
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
