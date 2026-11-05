import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { hasRole, useMe } from '@/features/auth';
import { errorMessage } from '@/utils/errors';
import { useCreateAccount, useSetRoles } from '../hooks/useOrg';
import type { AccountMode, IEmployee } from '../types/employee.types';
import { GRANTABLE_ROLES, ROLE_LABEL } from '../utils/labels';

/** Chọn vai trò (employee luôn có). Chỉ admin thấy lựa chọn "admin". */
function RolePicker({ value, onChange }: { value: string[]; onChange: (r: string[]) => void }) {
  const { data: me } = useMe();
  const roles = GRANTABLE_ROLES.filter((r) => r !== 'admin' || hasRole(me, 'admin'));
  return (
    <div className="grid gap-2">
      <Label>Vai trò</Label>
      <p className="text-xs text-muted-foreground">Mọi tài khoản đều có vai trò "{ROLE_LABEL.employee}".</p>
      <div className="flex flex-wrap gap-4">
        {roles.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-primary" checked={value.includes(r)}
              onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Hiện mật khẩu tạm MỘT LẦN để HR gửi cho nhân viên. */
export function TempPasswordDialog({ open, onOpenChange, userName, password }: {
  open: boolean; onOpenChange: (o: boolean) => void; userName: string; password: string;
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(`Tên đăng nhập: ${userName}\nMật khẩu tạm: ${password}`);
    toast.success('Đã sao chép');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mật khẩu tạm</DialogTitle>
          <DialogDescription>Gửi thông tin này cho nhân viên. Mật khẩu chỉ hiện một lần; lần đầu đăng nhập nhân viên phải đổi mật khẩu.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-lg border bg-muted p-4 font-mono text-sm">
          <div>Tên đăng nhập: <b>{userName}</b></div>
          <div>Mật khẩu tạm: <b data-testid="temp-password">{password}</b></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={copy}>Sao chép</Button>
          <Button onClick={() => onOpenChange(false)}>Xong</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cấp tài khoản: mời qua email hoặc mật khẩu tạm.
 * Mật khẩu tạm được trả lên component cha qua onTempPassword (dialog này đóng ngay khi tạo xong).
 */
export function CreateAccountDialog({ open, onOpenChange, employee, onTempPassword }: {
  open: boolean; onOpenChange: (o: boolean) => void; employee: IEmployee | null;
  onTempPassword: (userName: string, password: string) => void;
}) {
  const create = useCreateAccount();
  const [mode, setMode] = useState<AccountMode>('invite');
  const [userName, setUserName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !employee) return;
    create.reset();
    setMode(employee.email ? 'invite' : 'password');
    setUserName(employee.code);
    setRoles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, employee?.id]);

  if (!employee) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ id: employee.id, mode, roles, userName }, {
      onSuccess: (r) => {
        onOpenChange(false);
        if (r.tempPassword) onTempPassword(r.userName, r.tempPassword);
        else toast.success(`Đã gửi lời mời tới ${employee.email}`);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cấp tài khoản cho {employee.fullName}</DialogTitle>
            <DialogDescription>Nhân viên dùng tài khoản này để đăng nhập, chấm công, xin nghỉ.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-2">
              <Label>Cách cấp</Label>
              {(['invite', 'password'] as const).map((m) => (
                <label key={m} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${mode === m ? 'border-primary bg-accent' : ''}`}>
                  <input type="radio" name="mode" className="mt-1 accent-primary" checked={mode === m} disabled={m === 'invite' && !employee.email}
                    onChange={() => setMode(m)} />
                  <span>
                    <b>{m === 'invite' ? 'Mời qua email' : 'Mật khẩu tạm'}</b>
                    <span className="block text-muted-foreground">
                      {m === 'invite'
                        ? employee.email ? `Gửi link đặt mật khẩu tới ${employee.email} (hết hạn 72 giờ)` : 'Nhân viên chưa có email'
                        : 'Hệ thống tạo mật khẩu tạm để HR gửi cho nhân viên; bắt buộc đổi khi đăng nhập lần đầu'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <FormField id="userName" label="Tên đăng nhập" value={userName} onChange={(e) => setUserName(e.target.value)}
              hint="Mặc định là mã nhân viên. Nhân viên có thể đăng nhập bằng tên này hoặc email." />
            <RolePicker value={roles} onChange={setRoles} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
              <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Đang tạo…' : 'Cấp tài khoản'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
    </Dialog>
  );
}

/** Đổi vai trò tài khoản. */
export function RolesDialog({ open, onOpenChange, employee }: { open: boolean; onOpenChange: (o: boolean) => void; employee: IEmployee | null }) {
  const setRolesM = useSetRoles();
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    if (open && employee?.account) setRoles(employee.account.roles.filter((r) => r !== 'employee'));
  }, [open, employee]);
  if (!employee) return null;
  const submit = () =>
    setRolesM.mutate({ id: employee.id, roles }, {
      onSuccess: () => { toast.success('Đã cập nhật vai trò (có hiệu lực khi nhân viên đăng nhập lại)'); onOpenChange(false); },
      onError: (err) => toast.error(errorMessage(err)),
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vai trò của {employee.fullName}</DialogTitle>
          <DialogDescription>Quyết định nhân viên thấy và làm được gì trong hệ thống.</DialogDescription>
        </DialogHeader>
        <RolePicker value={roles} onChange={setRoles} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={submit} disabled={setRolesM.isPending}>Lưu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Chọn ngày nghỉ việc. */
export function ResignDialog({ open, onOpenChange, employee, onConfirm, pending }: {
  open: boolean; onOpenChange: (o: boolean) => void; employee: IEmployee | null; onConfirm: (leftAt: string) => void; pending: boolean;
}) {
  const [leftAt, setLeftAt] = useState('');
  useEffect(() => { if (open) setLeftAt(new Date().toLocaleDateString('sv-SE')); }, [open]);
  if (!employee) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cho {employee.fullName} nghỉ việc</DialogTitle>
          <DialogDescription>Tài khoản đăng nhập bị khoá ngay. Hồ sơ và dữ liệu chấm công vẫn được giữ lại.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="leftAt">Ngày nghỉ việc</Label>
          <Input id="leftAt" type="date" value={leftAt} onChange={(e) => setLeftAt(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button variant="destructive" disabled={!leftAt || pending} onClick={() => onConfirm(leftAt)}>Xác nhận nghỉ việc</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
