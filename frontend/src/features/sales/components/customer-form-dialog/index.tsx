import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { useEmployees } from '@/features/employees';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { salesApi } from '../../api/sales.api';
import { useSalesMutation } from '../../hooks/useSales';
import type { CustomerKind, ICustomerDetail, ICustomerRequest } from '../../types/sales.types';
import { CUSTOMER_KIND } from '../../utils/labels';

const empty: ICustomerRequest = { name: '', kind: 'Company', taxCode: '', address: '', phone: '', email: '', source: '', note: '', ownerEmployeeId: null, isActive: true };

/** Thêm / sửa khách hàng. Người phụ trách mặc định = tôi; giao cho người khác chỉ được nếu là cấp dưới (back-end kiểm tra). */
export function CustomerFormDialog({ open, detail, onClose, onCreated }: { open: boolean; detail?: ICustomerDetail | null; onClose: () => void; onCreated?: (id: string) => void }) {
  const [f, setF] = useState<ICustomerRequest>(empty);
  const employees = useEmployees().data ?? [];
  const save = useSalesMutation((b: ICustomerRequest) => salesApi.saveCustomer(detail?.customer.id, b));
  useEffect(() => {
    if (!open) return;
    save.reset();
    const c = detail?.customer;
    setF(c ? { name: c.name, kind: c.kind, taxCode: c.taxCode ?? '', address: detail?.address ?? '', phone: c.phone ?? '', email: c.email ?? '', source: c.source ?? '',
      note: detail?.note ?? '', ownerEmployeeId: c.ownerEmployeeId, isActive: c.isActive } : empty);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open, detail?.customer.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof ICustomerRequest>(k: K, v: ICustomerRequest[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{detail ? `Sửa khách ${detail.customer.code}` : 'Thêm khách hàng'}</DialogTitle>
          <DialogDescription>Khách chỉ hiện với người phụ trách, quản lý của họ và Ban giám đốc / kế toán.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...f, ownerEmployeeId: f.ownerEmployeeId || null }, {
            onSuccess: (id) => { toast.success('Đã lưu khách hàng'); onClose(); if (!detail && typeof id === 'string') onCreated?.(id); },
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <FormField id="cu-name" label="Tên khách hàng *" required autoFocus maxLength={200} value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField id="cu-kind" label="Loại" value={f.kind} onChange={(v) => set('kind', (v ?? 'Company') as CustomerKind)}
              options={(Object.keys(CUSTOMER_KIND) as CustomerKind[]).map((k) => ({ value: k, label: CUSTOMER_KIND[k] }))} />
            <FormField id="cu-tax" label="Mã số thuế" maxLength={20} value={f.taxCode ?? ''} onChange={(e) => set('taxCode', e.target.value)} error={errors.taxCode} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField id="cu-phone" label="Điện thoại" maxLength={30} value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
            <FormField id="cu-email" label="Email" type="email" maxLength={200} value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} error={errors.email} />
          </div>
          <FormField id="cu-addr" label="Địa chỉ" maxLength={300} value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} error={errors.address} />
          <div className="grid grid-cols-2 gap-3">
            <FormField id="cu-src" label="Nguồn khách" placeholder="Giới thiệu, website…" maxLength={100} value={f.source ?? ''} onChange={(e) => set('source', e.target.value)} error={errors.source} />
            <SelectField id="cu-owner" label="Người phụ trách" allowEmpty emptyLabel="— Tôi —" value={f.ownerEmployeeId ?? null} onChange={(v) => set('ownerEmployeeId', v)}
              options={employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.code})` }))} error={errors.ownerEmployeeId} />
          </div>
          <FormField id="cu-note" label="Ghi chú" maxLength={2000} value={f.note ?? ''} onChange={(e) => set('note', e.target.value)} error={errors.note} />
          {detail && <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.isActive ?? true} onCheckedChange={(c) => set('isActive', c === true)} /> Đang giao dịch (bỏ chọn = ngừng, ẩn khỏi danh sách)</label>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Huỷ</Button><Button type="submit" disabled={save.isPending}>Lưu</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
