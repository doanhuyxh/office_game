import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useCategories } from '../../hooks/useAssets';
import type { ICategory, ICategoryRequest } from '../../types/asset.types';

/** Tab Danh mục (HR): loại thiết bị — mã loại là tiền tố của mã thiết bị (TB-MT-00001). */
export function CategoriesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useCategories();
  const [edit, setEdit] = useState<ICategory | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">Mã loại dùng làm tiền tố mã thiết bị. Loại ngừng dùng vẫn giữ trên thiết bị cũ nhưng không chọn cho thiết bị mới.</p>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Mã</TableHead><TableHead>Tên loại</TableHead><TableHead>Thứ tự</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4}><Spinner /></TableCell></TableRow>}
            {data.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setEdit(c)} data-testid="category-row">
                <TableCell className="font-medium">{c.code}</TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell className="tabular-nums">{c.sortOrder}</TableCell>
                <TableCell><StatusBadge tone={c.isActive ? 'success' : 'muted'}>{c.isActive ? 'Đang dùng' : 'Ngừng dùng'}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <CategoryDialog open={creating || !!edit} category={creating ? null : edit} onClose={() => { setEdit(null); onCreatedClose(); }} />
    </div>
  );
}

function CategoryDialog({ open, category, onClose }: { open: boolean; category: ICategory | null; onClose: () => void }) {
  const [form, setForm] = useState<ICategoryRequest>({ code: '', name: '', sortOrder: 0, isActive: true });
  const save = useAssetMutation((b: ICategoryRequest) => assetApi.saveCategory(category?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(category ? { code: category.code, name: category.name, sortOrder: category.sortOrder, isActive: category.isActive } : { code: '', name: '', sortOrder: 0, isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id]);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? `Sửa loại ${category.code}` : 'Thêm loại thiết bị'}</DialogTitle>
          <DialogDescription>Mã loại tối đa 10 ký tự, viết hoa, không trùng.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...form, code: form.code.trim().toUpperCase(), name: form.name.trim() }, {
            onSuccess: () => { toast.success('Đã lưu loại thiết bị'); onClose(); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <FormField id="ct-code" label="Mã loại *" value={form.code} error={errors.code} maxLength={10} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <FormField id="ct-name" label="Tên loại *" value={form.name} error={errors.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <FormField id="ct-order" label="Thứ tự" type="number" value={form.sortOrder} error={errors.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
          <div className="flex items-center gap-2">
            <Checkbox id="ct-active" checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c === true })} />
            <Label htmlFor="ct-active">Đang dùng</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={!form.code.trim() || !form.name.trim() || save.isPending}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
