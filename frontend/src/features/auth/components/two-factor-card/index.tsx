import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PATHS } from '@/config/paths';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDisableTwoFactor, useRegenerateRecoveryCodes, useTwoFactorStatus } from '../../hooks/useTwoFactor';
import { RecoveryCodesPanel } from '../recovery-codes-panel';

const codeProps = {
  inputMode: 'numeric' as const, autoComplete: 'one-time-code', maxLength: 7, required: true,
  className: 'text-center font-mono text-lg tracking-[0.4em]',
};
const digits = (v: string) => v.replace(/[^\d ]/g, '');

/** Tạo lại mã dự phòng: nhập mã 6 số → hiện 10 mã mới (mã cũ hết hiệu lực). */
function RegenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const regen = useRegenerateRecoveryCodes();
  const [code, setCode] = useState('');
  const close = () => { setCode(''); regen.reset(); onClose(); };
  const errors = fieldErrors(regen.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tạo lại mã dự phòng</DialogTitle>
          <DialogDescription>Các mã dự phòng cũ sẽ hết hiệu lực ngay.</DialogDescription>
        </DialogHeader>
        {regen.data ? (
          <>
            <RecoveryCodesPanel codes={regen.data.recoveryCodes} />
            <DialogFooter><Button onClick={close}>Đã lưu, đóng</Button></DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); regen.mutate(code.trim(), { onError: (x) => !fieldErrors(x).code && toast.error(errorMessage(x)) }); }}>
            <FormField id="regen-code" label="Mã từ ứng dụng xác thực" {...codeProps} autoFocus error={errors.code}
              value={code} onChange={(e) => setCode(digits(e.target.value))} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Huỷ</Button>
              <Button type="submit" disabled={regen.isPending}>Tạo mã mới</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Tự tắt 2FA (không áp dụng cho admin / HR): cần mật khẩu + mã hiện tại. */
function DisableDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const disable = useDisableTwoFactor();
  const [f, setF] = useState({ password: '', code: '' });
  const close = () => { setF({ password: '', code: '' }); disable.reset(); onClose(); };
  const errors = fieldErrors(disable.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tắt xác thực 2 lớp</DialogTitle>
          <DialogDescription>Đăng nhập sẽ chỉ cần mật khẩu. Khoá trong ứng dụng xác thực và mã dự phòng bị xoá.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          disable.mutate({ currentPassword: f.password, code: f.code.trim() }, {
            onSuccess: () => { toast.success('Đã tắt xác thực 2 lớp'); close(); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <FormField id="dis-password" label="Mật khẩu hiện tại" type="password" autoComplete="current-password" required autoFocus
            error={errors.currentPassword} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <FormField id="dis-code" label="Mã từ ứng dụng xác thực" {...codeProps} error={errors.code}
            value={f.code} onChange={(e) => setF({ ...f, code: digits(e.target.value) })} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Huỷ</Button>
            <Button type="submit" variant="destructive" disabled={disable.isPending}>Tắt</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Thẻ "Xác thực 2 lớp" ở trang Hồ sơ: trạng thái, bật, tạo lại mã dự phòng, tắt (trừ admin / HR — bắt buộc). */
export function TwoFactorCard() {
  const navigate = useNavigate();
  const { data: s } = useTwoFactorStatus();
  const [dialog, setDialog] = useState<'regen' | 'disable' | null>(null);
  if (!s) return null;
  return (
    <Card data-testid="two-factor-card">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            Xác thực 2 lớp
            {s.enabled ? <StatusBadge tone="success">Đang bật</StatusBadge> : <StatusBadge tone="muted">Chưa bật</StatusBadge>}
          </CardTitle>
          <CardDescription>
            Đăng nhập cần thêm mã 6 số từ ứng dụng trên điện thoại (Google / Microsoft Authenticator…).
            {s.required && ' Bắt buộc với tài khoản admin / HR.'}
            {s.enabled && ` Còn ${s.recoveryCodesLeft} mã dự phòng.`}
            {s.enabled && s.recoveryCodesLeft <= 3 && ' Nên tạo lại mã dự phòng.'}
            {s.enabled && ' Mất điện thoại: dùng mã dự phòng hoặc nhờ HR đặt lại.'}
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.enabled ? (
            <>
              <Button variant="outline" onClick={() => setDialog('regen')}><KeyRound /> Tạo lại mã dự phòng</Button>
              {!s.required && <Button variant="ghost" className="text-destructive" onClick={() => setDialog('disable')}><ShieldOff /> Tắt</Button>}
            </>
          ) : (
            <Button onClick={() => navigate({ to: PATHS.setupTwoFactor, search: { returnUrl: PATHS.profile } })}><ShieldCheck /> Bật xác thực 2 lớp</Button>
          )}
        </div>
      </CardHeader>
      <RegenerateDialog open={dialog === 'regen'} onClose={() => setDialog(null)} />
      <DisableDialog open={dialog === 'disable'} onClose={() => setDialog(null)} />
    </Card>
  );
}
