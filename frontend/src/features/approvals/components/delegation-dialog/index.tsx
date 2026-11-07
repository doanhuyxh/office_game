import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { Textarea } from '@/components/common/textarea';
import { useEmployees } from '@/features/employees';
import { todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreateDelegation } from '../../hooks/useApprovals';
import type { ICreateDelegation } from '../../types/approval.types';

/** Số ngày tối đa của một lần uỷ quyền — khớp DelegationRules.MaxDays (BE kiểm tra lại). */
export const DELEGATION_MAX_DAYS = 90;

/**
 * Tạo uỷ quyền duyệt: người được uỷ quyền duyệt thay bước "Quản lý" trong khoảng ngày (tính cả hai đầu).
 * HR (`isHr`) chọn được người uỷ quyền là bất kỳ người quản lý nào; người khác chỉ uỷ quyền của chính mình.
 */
export function DelegationDialog({ open, onClose, isHr, myEmployeeId, canDelegateSelf }: {
  open: boolean;
  onClose: () => void;
  isHr: boolean;
  myEmployeeId: string | null;
  canDelegateSelf: boolean;
}) {
  const create = useCreateDelegation();
  const { data: employees = [] } = useEmployees({});
  const today = todayVn();
  const empty = (): ICreateDelegation => ({
    delegatorEmployeeId: canDelegateSelf ? myEmployeeId : null, delegateEmployeeId: '', fromDate: today, toDate: '', note: null,
  });
  const [f, setF] = useState<ICreateDelegation>(empty);
  useEffect(() => {
    if (!open) return;
    create.reset();
    setF(empty());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = <K extends keyof ICreateDelegation>(k: K, v: ICreateDelegation[K]) => setF((x) => ({ ...x, [k]: v }));
  const errors = fieldErrors(create.error);

  const label = (e: (typeof employees)[number]) => `${e.code} · ${e.fullName}`;
  // Người uỷ quyền (HR chọn): chỉ người đang có cấp dưới.
  const managerIds = useMemo(() => new Set(employees.map((e) => e.managerId).filter(Boolean)), [employees]);
  const delegatorOptions = employees.filter((e) => managerIds.has(e.id)).map((e) => ({ value: e.id, label: label(e), hint: e.departmentName ?? undefined }));
  const delegator = isHr ? f.delegatorEmployeeId : myEmployeeId;
  const delegateOptions = employees.filter((e) => e.id !== delegator).map((e) => ({ value: e.id, label: label(e), hint: e.departmentName ?? undefined }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ ...f, delegatorEmployeeId: isHr ? f.delegatorEmployeeId : null, note: f.note?.trim() || null }, {
      onSuccess: (d) => { toast.success(`Đã uỷ quyền cho ${d.delegate.fullName}`); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Uỷ quyền duyệt</DialogTitle>
          <DialogDescription>
            Người được uỷ quyền duyệt thay bước “Quản lý” cho đơn của cấp dưới trong khoảng ngày đã chọn (tối đa {DELEGATION_MAX_DAYS} ngày).
            Bước HR không đổi; không ai duyệt được đơn của chính mình.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4" data-testid="delegation-form">
          {isHr && (
            <SearchSelectField id="dg-delegator" label="Người uỷ quyền (quản lý) *" value={f.delegatorEmployeeId}
              onChange={(v) => setF((x) => ({ ...x, delegatorEmployeeId: v, delegateEmployeeId: x.delegateEmployeeId === v ? '' : x.delegateEmployeeId }))}
              options={delegatorOptions} placeholder="Chọn người quản lý" error={errors.delegatorEmployeeId} />
          )}
          <SearchSelectField id="dg-delegate" label="Người duyệt thay *" value={f.delegateEmployeeId || null}
            onChange={(v) => set('delegateEmployeeId', v ?? '')} options={delegateOptions} placeholder="Chọn nhân viên" error={errors.delegateEmployeeId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="dg-from" label="Từ ngày *" type="date" required value={f.fromDate} onChange={(e) => set('fromDate', e.target.value)}
              error={errors.fromDate} />
            <FormField id="dg-to" label="Đến hết ngày *" type="date" required min={f.fromDate > today ? f.fromDate : today} value={f.toDate}
              onChange={(e) => set('toDate', e.target.value)} error={errors.toDate} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dg-note">Ghi chú</Label>
            <Textarea id="dg-note" rows={2} maxLength={500} value={f.note ?? ''} placeholder="Vd: nghỉ phép, đi công tác"
              onChange={(e) => set('note', e.target.value || null)} />
            {errors.note && <p className="text-xs text-destructive">{errors.note}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending || !f.delegateEmployeeId || !f.toDate || (isHr && !f.delegatorEmployeeId)}>Uỷ quyền</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
