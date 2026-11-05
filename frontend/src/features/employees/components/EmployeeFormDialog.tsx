import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDepartments, useEmployees, useNextEmployeeCode, usePositions, useSaveEmployee } from '../hooks/useOrg';
import type { IEmployee, IUpsertEmployee } from '../types/employee.types';
import { STATUS_LABEL, today } from '../utils/labels';

const empty = (): IUpsertEmployee => ({
  code: '', fullName: '', email: '', phone: '', dateOfBirth: null,
  departmentId: null, positionId: null, managerId: null, status: 'Probation', joinedAt: today(), note: '',
});

/** Thêm / sửa hồ sơ nhân viên (HR). */
export function EmployeeFormDialog({ open, onOpenChange, employee, note, dateOfBirth }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee?: IEmployee | null;
  note?: string | null;
  dateOfBirth?: string | null;
}) {
  const isEdit = !!employee;
  const save = useSaveEmployee();
  const { data: departments = [] } = useDepartments();
  const { data: positions = [] } = usePositions();
  const { data: employees = [] } = useEmployees();
  const { data: nextCode } = useNextEmployeeCode(open && !isEdit);
  const [form, setForm] = useState<IUpsertEmployee>(empty);

  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(employee
      ? {
          code: employee.code, fullName: employee.fullName, email: employee.email ?? '', phone: employee.phone ?? '',
          dateOfBirth: dateOfBirth ?? null, departmentId: employee.departmentId, positionId: employee.positionId,
          managerId: employee.managerId, status: employee.status === 'Resigned' ? null : employee.status,
          joinedAt: employee.joinedAt, note: note ?? '',
        }
      : empty());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  const set = <K extends keyof IUpsertEmployee>(k: K, v: IUpsertEmployee[K]) => setForm((f) => ({ ...f, [k]: v }));
  const errors = fieldErrors(save.error);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: employee?.id, body: { ...form, dateOfBirth: form.dateOfBirth || null } },
      {
        onSuccess: (d) => {
          toast.success(isEdit ? 'Đã lưu hồ sơ' : `Đã thêm nhân viên ${d.employee.code}`);
          onOpenChange(false);
        },
        onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Sửa hồ sơ ${employee!.code}` : 'Thêm nhân viên'}</DialogTitle>
          <DialogDescription>Thông tin hồ sơ. Tài khoản đăng nhập cấp riêng sau khi lưu.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <FormField id="code" label="Mã nhân viên" value={form.code ?? ''} onChange={(e) => set('code', e.target.value)}
            placeholder={nextCode?.code} hint={isEdit ? undefined : `Để trống = tự sinh (${nextCode?.code ?? 'NV…'})`} error={errors.code} />
          <FormField id="fullName" label="Họ tên *" required value={form.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} />
          <FormField id="email" label="Email cá nhân" type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)}
            hint="Dùng để gửi lời mời / đặt lại mật khẩu" error={errors.email} />
          <FormField id="phone" label="Số điện thoại" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} error={errors.phone} />
          <SelectField id="departmentId" label="Phòng ban" allowEmpty value={form.departmentId} onChange={(v) => set('departmentId', v)}
            options={departments.map((d) => ({ value: d.id, label: d.name }))} error={errors.departmentId} />
          <SelectField id="positionId" label="Chức vụ" allowEmpty value={form.positionId} onChange={(v) => set('positionId', v)}
            options={positions.map((p) => ({ value: p.id, label: p.name }))} error={errors.positionId} />
          <SelectField id="managerId" label="Quản lý trực tiếp" allowEmpty value={form.managerId} onChange={(v) => set('managerId', v)}
            options={employees.filter((x) => x.id !== employee?.id).map((x) => ({ value: x.id, label: `${x.code} · ${x.fullName}` }))}
            error={errors.managerId} />
          {employee?.status === 'Resigned' ? (
            <div className="grid gap-2"><Label>Trạng thái</Label><p className="text-sm text-muted-foreground">Đã nghỉ việc (dùng "Khôi phục" để đi làm lại)</p></div>
          ) : (
            <SelectField id="status" label="Trạng thái" value={form.status} onChange={(v) => set('status', v as IUpsertEmployee['status'])}
              options={(['Probation', 'Active'] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] }))} error={errors.status} />
          )}
          <FormField id="joinedAt" label="Ngày vào làm *" type="date" required value={form.joinedAt} onChange={(e) => set('joinedAt', e.target.value)} error={errors.joinedAt} />
          <FormField id="dateOfBirth" label="Ngày sinh" type="date" value={form.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value || null)} />
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="note">Ghi chú</Label>
            <Textarea id="note" rows={2} value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
