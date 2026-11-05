import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import map from '@shared/office-map.json';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDeleteDepartment, useDepartments, useEmployees, useSaveDepartment } from '../hooks/useOrg';
import type { IDepartment, IUpsertDepartment } from '../types/employee.types';

function DepartmentDialog({ open, onOpenChange, dept }: { open: boolean; onOpenChange: (o: boolean) => void; dept: IDepartment | null }) {
  const save = useSaveDepartment();
  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  const [form, setForm] = useState<IUpsertDepartment>({ name: '' });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(dept ? { name: dept.name, code: dept.code, parentId: dept.parentId, headEmployeeId: dept.headEmployeeId, mapZone: dept.mapZone, sortOrder: dept.sortOrder } : { name: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dept?.id]);
  const errors = fieldErrors(save.error);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: dept?.id, body: form }, {
      onSuccess: () => { toast.success('Đã lưu phòng ban'); onOpenChange(false); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{dept ? 'Sửa phòng ban' : 'Thêm phòng ban'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FormField id="d-name" label="Tên phòng ban *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          <FormField id="d-code" label="Mã" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <SelectField id="d-parent" label="Thuộc phòng ban" allowEmpty emptyLabel="— Cấp cao nhất —" value={form.parentId}
            onChange={(v) => setForm({ ...form, parentId: v })} error={errors.parentId}
            options={departments.filter((d) => d.id !== dept?.id).map((d) => ({ value: d.id, label: d.name }))} />
          <SelectField id="d-head" label="Trưởng phòng" allowEmpty value={form.headEmployeeId} onChange={(v) => setForm({ ...form, headEmployeeId: v })}
            error={errors.headEmployeeId} options={employees.map((e) => ({ value: e.id, label: `${e.code} · ${e.fullName}` }))} />
          <SelectField id="d-zone" label="Khu vực trong văn phòng 3D" allowEmpty value={form.mapZone} onChange={(v) => setForm({ ...form, mapZone: v })}
            options={map.zones.map((z) => ({ value: z.id, label: z.name }))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DepartmentsPanel({ canEdit }: { canEdit: boolean }) {
  const { data: departments = [], isLoading } = useDepartments();
  const remove = useDeleteDepartment();
  const [editing, setEditing] = useState<IDepartment | null | undefined>(undefined); // undefined = đóng, null = thêm mới
  const [deleting, setDeleting] = useState<IDepartment | null>(null);
  const byId = new Map(departments.map((d) => [d.id, d]));
  const zoneName = (id: string | null) => map.zones.find((z) => z.id === id)?.name;

  return (
    <div className="space-y-4">
      {canEdit && <div className="flex justify-end"><Button onClick={() => setEditing(null)}><Plus /> Thêm phòng ban</Button></div>}
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phòng ban</TableHead><TableHead>Thuộc</TableHead><TableHead>Trưởng phòng</TableHead>
              <TableHead>Khu vực 3D</TableHead><TableHead className="text-right">Nhân viên</TableHead>{canEdit && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && departments.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có phòng ban</TableCell></TableRow>
            )}
            {departments.map((d) => (
              <TableRow key={d.id}>
                <TableCell><span className="font-medium">{d.name}</span>{d.code && <span className="ml-2 text-xs text-muted-foreground">{d.code}</span>}</TableCell>
                <TableCell>{d.parentId ? byId.get(d.parentId)?.name : '—'}</TableCell>
                <TableCell>{d.headName ?? '—'}</TableCell>
                <TableCell>{zoneName(d.mapZone) ?? '—'}</TableCell>
                <TableCell className="text-right">{d.employeeCount}</TableCell>
                {canEdit && (
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label="Sửa" onClick={() => setEditing(d)}><Pencil /></Button>
                    <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => setDeleting(d)}><Trash2 /></Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DepartmentDialog open={editing !== undefined} onOpenChange={() => setEditing(undefined)} dept={editing ?? null} />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá phòng ban "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Chỉ xoá được khi phòng ban không còn nhân viên và không có phòng ban con.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id, {
              onSuccess: () => toast.success('Đã xoá phòng ban'), onError: (err) => toast.error(errorMessage(err)),
            })}>Xoá</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
