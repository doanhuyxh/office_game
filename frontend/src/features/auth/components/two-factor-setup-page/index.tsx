import { useEffect, useRef, useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { Spinner } from '@/components/feedback/Spinner';
import { PATHS } from '@/config/paths';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useMe } from '../../hooks/useAuth';
import { useLogout } from '../../hooks/useLogout';
import { useEnableTwoFactor, useTwoFactorSetup } from '../../hooks/useTwoFactor';
import { safeReturnPath } from '../../utils/safeReturnPath';
import { AuthShell } from '../auth-shell';
import { RecoveryCodesPanel } from '../recovery-codes-panel';

const route = getRouteApi('/setup-2fa');

/**
 * Bật xác thực 2 lớp: quét QR (hoặc nhập khoá) → nhập mã 6 số → hiện mã dự phòng một lần.
 * Admin / HR chưa bật bị guard đưa tới đây (bắt buộc); người khác vào từ thẻ "Xác thực 2 lớp" ở Hồ sơ.
 */
export function TwoFactorSetupPage() {
  const { returnUrl } = route.useSearch();
  const navigate = useNavigate();
  const logout = useLogout();
  const { data: me } = useMe();
  const setup = useTwoFactorSetup();
  const enable = useEnableTwoFactor();
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const started = useRef(false);
  // Mã dự phòng lấy thẳng từ kết quả enable (không qua state riêng) → không nháy sang màn "đã bật" khi `me` làm mới.
  const codes = enable.data?.recoveryCodes ?? null;
  const mandatory = !!me?.mustSetupTwoFactor;
  const alreadyOn = !!me?.twoFactorEnabled && !codes && !enable.isPending;

  useEffect(() => {
    // POST setup đúng một lần (StrictMode gọi effect 2 lần). Đã bật thì không cần khoá.
    if (started.current || !me || me.twoFactorEnabled) return;
    started.current = true;
    setup.mutate(false);
  }, [me, setup]);

  const leave = () => navigate({ to: safeReturnPath(returnUrl) ?? PATHS.dashboard });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    enable.mutate(code.trim());
  };

  const copyKey = () => setup.data && navigator.clipboard.writeText(setup.data.sharedKey.replace(/ /g, '')).then(() => toast.success('Đã sao chép khoá'));

  if (codes)
    return (
      <AuthShell title="Đã bật xác thực 2 lớp" description="Từ giờ đăng nhập cần thêm mã từ điện thoại">
        <div className="grid gap-4">
          <RecoveryCodesPanel codes={codes} userName={me?.userName} />
          <Label className="font-normal">
            <Checkbox checked={saved} onCheckedChange={(c) => setSaved(c === true)} data-testid="recovery-saved" /> Tôi đã lưu mã dự phòng
          </Label>
          <Button disabled={!saved} onClick={leave}>Tiếp tục</Button>
        </div>
      </AuthShell>
    );

  if (alreadyOn)
    return (
      <AuthShell title="Xác thực 2 lớp" description="Tài khoản của bạn đã bật xác thực 2 lớp">
        <Button onClick={leave}>Tiếp tục</Button>
      </AuthShell>
    );

  const errors = fieldErrors(enable.error);
  return (
    <AuthShell title="Bật xác thực 2 lớp"
      description={mandatory
        ? 'Tài khoản admin / HR bắt buộc dùng xác thực 2 lớp. Hoàn tất bước này để tiếp tục làm việc.'
        : 'Bảo vệ tài khoản bằng mã 6 số từ ứng dụng trên điện thoại.'}>
      <div className="grid gap-4">
        <ol className="ml-4 list-decimal space-y-1 text-sm text-muted-foreground">
          <li>Cài ứng dụng xác thực: Google Authenticator, Microsoft Authenticator hoặc tương tự.</li>
          <li>Quét mã QR dưới đây (hoặc nhập khoá thủ công).</li>
          <li>Nhập mã 6 số ứng dụng hiển thị.</li>
        </ol>
        {setup.isPending || (!setup.data && !setup.error) ? <Spinner /> : setup.error ? (
          <p className="text-sm text-destructive">{errorMessage(setup.error)}</p>
        ) : setup.data && (
          <div className="grid justify-items-center gap-3">
            <div className="rounded-lg bg-white p-3" data-testid="totp-qr">
              <QRCodeSVG value={setup.data.authenticatorUri} size={168} marginSize={0} title="Mã QR thiết lập xác thực 2 lớp" />
            </div>
            <div className="grid w-full gap-1 text-center">
              <span className="text-xs text-muted-foreground">Không quét được? Nhập khoá:</span>
              <div className="flex items-center justify-center gap-1">
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm" data-testid="totp-key">{setup.data.sharedKey}</code>
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Sao chép khoá" onClick={copyKey}><Copy className="size-4" /></Button>
              </div>
            </div>
          </div>
        )}
        <form onSubmit={submit} className="grid gap-4">
          <FormField id="totp-code" label="Mã xác thực" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required
            className="text-center font-mono text-lg tracking-[0.4em]" error={errors.code}
            value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
          {enable.error && !errors.code && <p className="text-sm text-destructive">{errorMessage(enable.error)}</p>}
          <Button type="submit" disabled={enable.isPending || !setup.data}>{enable.isPending ? 'Đang kiểm tra…' : 'Bật xác thực 2 lớp'}</Button>
        </form>
        <div className="flex justify-between text-sm">
          {mandatory
            ? <button type="button" className="text-muted-foreground hover:text-primary hover:underline" onClick={() => void logout()}>Đăng xuất</button>
            : <button type="button" className="text-muted-foreground hover:text-primary hover:underline" onClick={leave}>Huỷ</button>}
          <button type="button" className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary hover:underline"
            disabled={setup.isPending} onClick={() => { setCode(''); enable.reset(); setup.mutate(true); }}>
            <RefreshCw className="size-3.5" /> Tạo mã QR mới
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
