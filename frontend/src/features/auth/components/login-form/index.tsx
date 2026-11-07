import { useState } from 'react';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { useLogin } from '../../hooks/useAuth';
import { ApiError } from '@/services/api-client';
import { PATHS } from '@/config/paths';
import { safeReturnPath } from '../../utils/safeReturnPath';
import type { IMe } from '../../types/auth.types';
import { AuthShell } from '../auth-shell';
import { TwoFactorLoginStep } from '../two-factor-login-step';

const route = getRouteApi('/login');

export function LoginForm() {
  const { returnUrl } = route.useSearch();
  const navigate = useNavigate();
  const login = useLogin();
  const [form, setForm] = useState({ login: '', password: '' });
  // Tài khoản đã bật 2FA: /login trả 403 "2fa_required" + cookie tạm → hỏi mã ở bước 2.
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [notice, setNotice] = useState('');

  const done = (me: IMe) =>
    me.mustChangePassword
      ? navigate({ to: PATHS.changePassword, search: { returnUrl } })
      : me.mustSetupTwoFactor
        ? navigate({ to: PATHS.setupTwoFactor, search: { returnUrl } })
        : navigate({ to: safeReturnPath(returnUrl) ?? PATHS.dashboard });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    login.mutate(
      { login: form.login.trim(), password: form.password },
      {
        onSuccess: done,
        onError: (err) => { if (err instanceof ApiError && err.problem.title === '2fa_required') setStep('code'); },
      },
    );
  };

  if (step === 'code')
    return (
      <AuthShell title="Xác thực 2 lớp" description="Nhập mã để hoàn tất đăng nhập">
        <TwoFactorLoginStep onSuccess={done} onBack={(msg) => { setStep('password'); login.reset(); setNotice(msg ?? ''); setForm({ ...form, password: '' }); }} />
      </AuthShell>
    );

  const error = notice
    || (login.error instanceof ApiError ? login.error.message : login.error ? 'Không kết nối được máy chủ' : '');

  return (
    <AuthShell title="Đăng nhập" description="Đăng nhập bằng email hoặc mã nhân viên">
      <form onSubmit={submit} className="grid gap-4">
        <FormField id="login" label="Email / Mã nhân viên" autoComplete="username" required autoFocus
          value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} />
        <FormField id="password" label="Mật khẩu" type="password" autoComplete="current-password" required
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
        <Link to={PATHS.forgotPassword} className="text-center text-sm text-muted-foreground hover:text-primary hover:underline">
          Quên mật khẩu?
        </Link>
      </form>
    </AuthShell>
  );
}
