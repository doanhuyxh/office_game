import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { MoneyField } from '@/components/common/money-input';
import { Label } from '@/components/common/label';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { departmentOptions, useDepartments, useEmployees } from '@/features/employees';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation } from '../../hooks/useAssets';
import type { BillingCycle, IService, IServiceRequest } from '../../types/asset.types';
import { BILLING_OPTIONS, employeeOptions } from '../../utils/labels';

const empty = (): IServiceRequest => ({
  name: '', vendor: null, plan: null, url: null, seatLimit: null, billingCycle: 'Monthly', cost: null, renewalDate: null,
  ownerDepartmentId: null, adminEmployeeId: null, note: null,
});

/** Thêm / sửa dịch vụ (Figma, Google Workspace…). Không lưu mật khẩu. */
export function ServiceFormDialog({ open, onOpenChange, service }: { open: boolean; onOpenChange: (o: boolean) => void; service?: IService | null }) {
  const employees = useEmployees();
  const { data: departments = [] } = useDepartments();
  const [form, setForm] = useState<IServiceRequest>(empty);
  const [cost, setCost] = useState<number | null>(null);
  const [limit, setLimit] = useState('');
  const save = useAssetMutation((b: IServiceRequest) => assetApi.saveService(service?.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(service ? {
      name: service.name, vendor: service.vendor, plan: service.plan, url: service.url, seatLimit: service.seatLimit, billingCycle: service.billingCycle,
      cost: service.cost, renewalDate: service.renewalDate, ownerDepartmentId: service.ownerDepartmentId, adminEmployeeId: service.adminEmployeeId, note: service.note,
    } : empty());
    setCost(service?.cost ?? null);
    setLimit(service?.seatLimit != null ? String(service.seatLimit) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service?.id]);
  const set = <K extends keyof IServiceRequest>(k: K, v: IServiceRequest[K]) => setForm((f) => ({ ...f, [k]: v }));
  const text = (k: 'vendor' | 'plan' | 'url' | 'note') => (e: { target: { value: string } }) => set(k, e.target.value || null);
  const errors = fieldErrors(save.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{service ? `Sửa dịch vụ ${service.name}` : 'Thêm dịch vụ'}</DialogTitle>
          <DialogDescription>Phần mềm / dịch vụ trả phí của công ty. Chỉ ghi tên đăng nhập của từng ghế, không lưu mật khẩu.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...form, name: form.name.trim(), cost, seatLimit: limit.trim() ? Number(limit) : null }, {
            onSuccess: () => { toast.success(service ? 'Đã lưu dịch vụ' : 'Đã thêm dịch vụ'); onOpenChange(false); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <FormField id="sv-name" label="Tên dịch vụ *" value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
          <FormField id="sv-vendor" label="Nhà cung cấp" value={form.vendor ?? ''} error={errors.vendor} onChange={text('vendor')} />
          <FormField id="sv-plan" label="Gói" value={form.plan ?? ''} error={errors.plan} onChange={text('plan')} />
          <FormField id="sv-url" label="Đường dẫn" value={form.url ?? ''} error={errors.url} onChange={text('url')} placeholder="https://…" />
          <FormField id="sv-limit" label="Số ghế tối đa" inputMode="numeric" value={limit} error={errors.seatLimit} hint="Bỏ trống = không giới hạn"
            onChange={(e) => setLimit(e.target.value.replace(/[^\d]/g, ''))} />
          <SelectField id="sv-billing" label="Chu kỳ thanh toán" value={form.billingCycle} onChange={(v) => set('billingCycle', (v ?? 'None') as BillingCycle)} options={BILLING_OPTIONS} />
          <MoneyField id="sv-cost" label="Chi phí mỗi kỳ (₫)" value={cost} error={errors.cost} onValueChange={setCost} />
          <FormField id="sv-renewal" label="Ngày gia hạn" type="date" value={form.renewalDate ?? ''} error={errors.renewalDate} onChange={(e) => set('renewalDate', e.target.value || null)} />
          <SelectField id="sv-dept" label="Phòng ban sở hữu" value={form.ownerDepartmentId} onChange={(v) => set('ownerDepartmentId', v)} allowEmpty
            options={departmentOptions(departments)} />
          <SearchSelectField id="sv-admin" label="Người quản trị" value={form.adminEmployeeId} onChange={(v) => set('adminEmployeeId', v)} allowEmpty options={employeeOptions(employees.data)} />
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="sv-note">Ghi chú</Label>
            <Textarea id="sv-note" rows={3} value={form.note ?? ''} onChange={text('note')} />
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
