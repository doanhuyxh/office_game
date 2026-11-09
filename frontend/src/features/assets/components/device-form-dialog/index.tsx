import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { MoneyField } from '@/components/common/money-input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useCategories } from '../../hooks/useAssets';
import type { IDevice, IDeviceRequest } from '../../types/asset.types';

const empty = (): IDeviceRequest => ({
  categoryId: null, name: '', brand: null, model: null, serialNumber: null, purchaseDate: null, purchasePrice: null, warrantyUntil: null, note: null,
  depreciationMonths: null,
});

/** Thêm / sửa thiết bị (HR). Mã thiết bị do hệ thống cấp theo loại. */
export function DeviceFormDialog({ open, onOpenChange, device }: { open: boolean; onOpenChange: (o: boolean) => void; device?: IDevice | null }) {
  const { data: categories = [] } = useCategories();
  const [form, setForm] = useState<IDeviceRequest>(empty);
  const [price, setPrice] = useState<number | null>(null);
  const [months, setMonths] = useState('');
  const save = useAssetMutation((b: IDeviceRequest) => assetApi.saveDevice(device?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(device ? {
      categoryId: device.categoryId, name: device.name, brand: device.brand, model: device.model, serialNumber: device.serialNumber,
      purchaseDate: device.purchaseDate, purchasePrice: device.purchasePrice, warrantyUntil: device.warrantyUntil, note: device.note,
      depreciationMonths: device.depreciationMonths,
    } : empty());
    setPrice(device?.purchasePrice ?? null);
    setMonths(device?.depreciationMonths != null ? String(device.depreciationMonths) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, device?.id]);
  const set = <K extends keyof IDeviceRequest>(k: K, v: IDeviceRequest[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: 'brand' | 'model' | 'serialNumber' | 'note') => (e: { target: { value: string } }) => set(k, e.target.value || null);
  const errors = fieldErrors(save.error);
  const categoryMonths = categories.find((c) => c.id === form.categoryId)?.depreciationMonths;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{device ? `Sửa thiết bị ${device.code}` : 'Thêm thiết bị'}</DialogTitle>
          <DialogDescription>Mã thiết bị (TB-loại-số) tự sinh khi lưu. Cấp phát cho nhân viên ở chi tiết thiết bị.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...form, name: form.name.trim(), purchasePrice: price, depreciationMonths: months === '' ? null : Number(months) }, {
            onSuccess: () => { toast.success(device ? 'Đã lưu thiết bị' : 'Đã thêm thiết bị'); onOpenChange(false); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <SelectField id="dv-category" label="Loại *" value={form.categoryId} onChange={(v) => set('categoryId', v)} error={errors.categoryId}
            options={categories.filter((c) => c.isActive || c.id === device?.categoryId).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
          <FormField id="dv-name" label="Tên thiết bị *" value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
          <FormField id="dv-brand" label="Hãng" value={form.brand ?? ''} error={errors.brand} onChange={text('brand')} />
          <FormField id="dv-model" label="Model" value={form.model ?? ''} error={errors.model} onChange={text('model')} />
          <FormField id="dv-serial" label="Số serial" value={form.serialNumber ?? ''} error={errors.serialNumber} onChange={text('serialNumber')} />
          <MoneyField id="dv-price" label="Giá mua (₫)" value={price} error={errors.purchasePrice} onValueChange={setPrice} />
          <FormField id="dv-purchase" label="Ngày mua" type="date" value={form.purchaseDate ?? ''} error={errors.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value || null)} />
          <FormField id="dv-warranty" label="Bảo hành đến" type="date" value={form.warrantyUntil ?? ''} error={errors.warrantyUntil} onChange={(e) => set('warrantyUntil', e.target.value || null)} />
          <FormField id="dv-months" label="Số tháng khấu hao" inputMode="numeric" value={months} error={errors.depreciationMonths}
            placeholder={categoryMonths ? `Theo loại: ${categoryMonths}` : 'Theo loại'}
            hint="Để trống = theo loại; 0 = không khấu hao" onChange={(e) => setMonths(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} />
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="dv-note">Ghi chú</Label>
            <Textarea id="dv-note" rows={3} value={form.note ?? ''} onChange={text('note')} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
