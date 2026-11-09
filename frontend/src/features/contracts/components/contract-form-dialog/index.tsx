import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { MoneyField } from '@/components/common/money-input';
import { SelectField } from '@/components/common/SelectField';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { Textarea } from '@/components/common/textarea';
import { useEmployees } from '@/features/employees';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useNextContractNumber, useSaveContract } from '../../hooks/useContracts';
import type { ContractType, IContract, IUpsertContract } from '../../types/contract.types';
import { CONTRACT_TYPE } from '../../utils/labels';

const empty = (employeeId = ''): IUpsertContract => ({
  employeeId, number: '', type: 'Fixed', signedDate: null, startDate: '', endDate: null, jobTitle: null, salary: null, allowance: null, note: null,
});


/** Thêm / sửa hợp đồng (HR). Quy tắc thời hạn kiểm tra ở back-end; lỗi hiện theo field. */
export function ContractFormDialog({ open, onClose, contract, employeeId }: {
  open: boolean;
  onClose: () => void;
  /** Có = sửa */
  contract?: IContract | null;
  /** Chọn sẵn nhân viên khi thêm */
  employeeId?: string;
}) {
  const save = useSaveContract();
  const { data: employees = [] } = useEmployees({});
  const [f, setF] = useState<IUpsertContract>(empty());
  // Thêm mới: điền sẵn số tự sinh theo loại; HR gõ tay rồi thì không ghi đè.
  const [numberEdited, setNumberEdited] = useState(false);
  const { data: next } = useNextContractNumber(f.type, open && !contract);
  useEffect(() => {
    if (next && !contract && !numberEdited) setF((x) => ({ ...x, number: next.number }));
  }, [next, contract, numberEdited]);
  useEffect(() => {
    if (!open) return;
    save.reset();
    setNumberEdited(false);
    setF(contract ? {
      employeeId: contract.employee.id, number: contract.number, type: contract.type, signedDate: contract.signedDate, startDate: contract.startDate,
      endDate: contract.endDate, jobTitle: contract.jobTitle, salary: contract.salary, allowance: contract.allowance, note: contract.note,
    } : empty(employeeId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contract?.id]);
  const errors = fieldErrors(save.error);
  const set = <K extends keyof IUpsertContract>(k: K, v: IUpsertContract[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: contract?.id, body: { ...f, endDate: f.type === 'Indefinite' ? null : f.endDate } }, {
      onSuccess: () => { toast.success(contract ? 'Đã lưu hợp đồng' : 'Đã thêm hợp đồng'); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{contract ? `Sửa hợp đồng ${contract.number}` : 'Thêm hợp đồng'}</DialogTitle>
          <DialogDescription>
            Xác định thời hạn tối đa 36 tháng, thử việc tối đa 180 ngày. Lương được mã hoá khi lưu; chỉ HR và chính nhân viên xem được.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <SearchSelectField id="c-employee" label="Nhân viên *" value={f.employeeId || null} onChange={(v) => set('employeeId', v ?? '')} error={errors.employeeId}
            placeholder="Chọn nhân viên" options={employees.map((e) => ({ value: e.id, label: `${e.code} · ${e.fullName}${e.departmentName ? ` (${e.departmentName})` : ''}` }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="c-number" label={contract ? 'Số hợp đồng *' : 'Số hợp đồng'} required={!!contract} maxLength={50} value={f.number} onChange={(e) => { setNumberEdited(true); set('number', e.target.value); }}
              error={errors.number} placeholder={contract ? 'Vd: 012/2026/HĐLĐ' : 'Để trống = tự sinh'} />
            <SelectField id="c-type" label="Loại hợp đồng *" value={f.type} onChange={(v) => set('type', (v ?? 'Fixed') as ContractType)} error={errors.type}
              options={(Object.keys(CONTRACT_TYPE) as ContractType[]).map((t) => ({ value: t, label: CONTRACT_TYPE[t] }))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="c-start" label="Ngày bắt đầu *" type="date" required value={f.startDate} onChange={(e) => set('startDate', e.target.value)} error={errors.startDate} />
            <FormField id="c-end" label={f.type === 'Indefinite' ? 'Ngày kết thúc (không có)' : 'Ngày kết thúc *'} type="date" disabled={f.type === 'Indefinite'}
              value={f.type === 'Indefinite' ? '' : f.endDate ?? ''} onChange={(e) => set('endDate', e.target.value || null)} error={errors.endDate} />
            <FormField id="c-signed" label="Ngày ký" type="date" value={f.signedDate ?? ''} onChange={(e) => set('signedDate', e.target.value || null)} error={errors.signedDate} />
          </div>
          <FormField id="c-title" label="Chức danh trên hợp đồng" maxLength={200} value={f.jobTitle ?? ''} onChange={(e) => set('jobTitle', e.target.value || null)} error={errors.jobTitle} />
          <div className="grid gap-3 sm:grid-cols-2">
            <MoneyField id="c-salary" label="Lương cơ bản (VNĐ/tháng)" value={f.salary} onValueChange={(v) => set('salary', v)} error={errors.salary} />
            <MoneyField id="c-allowance" label="Phụ cấp (VNĐ/tháng)" value={f.allowance} onValueChange={(v) => set('allowance', v)} error={errors.allowance} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="c-note">Ghi chú</Label>
            <Textarea id="c-note" rows={2} maxLength={1000} value={f.note ?? ''} onChange={(e) => set('note', e.target.value || null)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>{contract ? 'Lưu' : 'Thêm hợp đồng'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
