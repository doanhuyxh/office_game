import { useState } from 'react';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { useLogin } from '../hooks/useAuth';
import { ApiError } from '@/services/api-client';
import { PATHS } from '@/config/paths';
import { safeReturnPath } from '../utils/safeReturnPath';
import { AuthShell } from './AuthShell';

const route = getRouteApi('/login');

export function LoginForm() {
  const { returnUrl } = route.useSearch();
  const navigate = useNavigate();
  const login = useLogin();
  const [form, setForm] = useState({ login: '', password: '' });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { login: form.login.trim(), password: form.password },
      {
        onSuccess: (me) =>
          me.mustChangePassword
            ? navigate({ to: PATHS.changePassword, search: { returnUrl } })
            : navigate({ to: safeReturnPath(returnUrl) ?? PATHS.dashboard }),
      },
    );
  };

  const error = login.error instanceof ApiError ? login.error.message : login.error ? 'Không kết nối được máy chủ' : '';

  return (
    <AuthShell title="OfficeHub" description="Đăng nhập bằng email hoặc mã nhân viên">
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
