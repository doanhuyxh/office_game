import { useState } from 'react';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { ApiError } from '@/services/api-client';
import type { IMe } from '../../types/auth.types';
import { useLoginTwoFactor } from '../../hooks/useTwoFactor';

/** Bước 2 đăng nhập: mã 6 số từ ứng dụng xác thực, hoặc mã dự phòng. Hết hạn cookie tạm (5 phút) → quay lại bước mật khẩu. */
export function TwoFactorLoginStep({ onSuccess, onBack }: { onSuccess: (me: IMe) => void; onBack: (notice?: string) => void }) {
  const verify = useLoginTwoFactor();
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    verify.mutate({ code: code.trim(), isRecoveryCode: recovery }, {
      onSuccess,
      onError: (err) => { if (err instanceof ApiError && err.problem.title === '2fa_expired') onBack(err.message); },
    });
  };

  const error = verify.error instanceof ApiError ? verify.error.message : verify.error ? 'Không kết nối được máy chủ' : '';

  return (
    <form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {recovery
          ? 'Nhập một mã dự phòng (dạng XXXXX-XXXXX). Mỗi mã chỉ dùng được một lần.'
          : 'Mở ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…) và nhập mã 6 số của OfficeHub.'}
      </p>
      {recovery ? (
        <FormField key="recovery" id="recovery-code" label="Mã dự phòng" autoComplete="off" required autoFocus
          value={code} onChange={(e) => setCode(e.target.value)} />
      ) : (
        <FormField key="totp" id="totp-code" label="Mã xác thực" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}"
          maxLength={7} required autoFocus className="text-center font-mono text-lg tracking-[0.4em]"
          value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))} />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={verify.isPending}>{verify.isPending ? 'Đang kiểm tra…' : 'Xác nhận'}</Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-muted-foreground hover:text-primary hover:underline" onClick={() => onBack()}>← Đăng nhập lại</button>
        <button type="button" className="text-muted-foreground hover:text-primary hover:underline"
          onClick={() => { setRecovery(!recovery); setCode(''); verify.reset(); }}>
          {recovery ? 'Dùng mã từ ứng dụng' : 'Dùng mã dự phòng'}
        </button>
      </div>
    </form>
  );
}
