import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { PATHS } from '@/config/paths';
import { useForgotPassword } from '../hooks/useAuth';
import { AuthShell } from './AuthShell';

export function ForgotPasswordForm() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    forgot.mutate(email.trim());
  };

  return (
    <AuthShell title="Quên mật khẩu" description="Nhập email đã đăng ký, hệ thống sẽ gửi link đặt lại mật khẩu">
      {forgot.isSuccess ? (
        <div className="grid gap-4 text-center text-sm">
          <p>Nếu email <b>{email}</b> có tài khoản, bạn sẽ nhận được link đặt lại mật khẩu trong vài phút (kiểm tra cả thư rác).</p>
          <p className="text-muted-foreground">Không có email? Liên hệ HR để được cấp mật khẩu tạm.</p>
          <Link to={PATHS.login} className="text-primary hover:underline">← Về trang đăng nhập</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <FormField id="email" label="Email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          {forgot.isError && <p className="text-sm text-destructive">Không kết nối được máy chủ</p>}
          <Button type="submit" disabled={forgot.isPending}>{forgot.isPending ? 'Đang gửi…' : 'Gửi link đặt lại mật khẩu'}</Button>
          <Link to={PATHS.login} className="text-center text-sm text-muted-foreground hover:underline">← Về trang đăng nhập</Link>
        </form>
      )}
    </AuthShell>
  );
}
