import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { todayVn } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useBulkResignEmployees } from '../../hooks/useOrg';
import type { IEmployee } from '../../types/employee.types';

/** Cho nhiều người nghỉ việc cùng một ngày (người đã nghỉ được bỏ qua). Phải gõ số người để xác nhận. */
export function BulkResignDialog({ employees, open, onOpenChange, onDone }: {
  employees: IEmployee[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const resign = useBulkResignEmployees();
  const [leftAt, setLeftAt] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => { if (open) { setLeftAt(todayVn()); setConfirm(''); } }, [open]);
  const targets = employees.filter((e) => e.status !== 'Resigned');
  const n = targets.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cho {n} nhân viên nghỉ việc</DialogTitle>
          <DialogDescription>
            Tài khoản đăng nhập bị khoá ngay, họ được gỡ khỏi vai trò quản lý / trưởng phòng. Hồ sơ và dữ liệu chấm công vẫn được giữ lại.
            {employees.length > n && ` Bỏ qua ${employees.length - n} người đã nghỉ.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 overflow-y-auto rounded-lg border px-3 py-2 text-sm">
          {targets.map((e) => (
            <li key={e.id} className="truncate"><span className="font-mono text-xs text-muted-foreground">{e.code}</span> {e.fullName}</li>
          ))}
        </ul>
        <div className="grid gap-2">
          <Label htmlFor="bulk-leftAt">Ngày nghỉ việc</Label>
          <Input id="bulk-leftAt" type="date" value={leftAt} onChange={(e) => setLeftAt(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="bulk-confirm">Gõ <b>{n}</b> để xác nhận</Label>
          <Input id="bulk-confirm" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="destructive" disabled={!leftAt || n === 0 || confirm.trim() !== String(n) || resign.isPending}
            onClick={() => resign.mutate({ ids: targets.map((e) => e.id), leftAt }, {
              onSuccess: (r) => { toast.success(`Đã cho ${r.affected} nhân viên nghỉ việc và khoá tài khoản`); onDone(); onOpenChange(false); },
              onError: (err) => toast.error(errorMessage(err)),
            })}>
            Xác nhận nghỉ việc
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
