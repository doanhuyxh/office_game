import { useState } from 'react';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { useChangePassword } from '../hooks/useAuth';
import { ApiError } from '@/services/api-client';
import { PATHS } from '@/config/paths';
import { safeReturnPath } from '../utils/safeReturnPath';
import { AuthShell } from './AuthShell';

const route = getRouteApi('/change-password');

export function ChangePasswordForm() {
  const { returnUrl } = route.useSearch();
  const navigate = useNavigate();
  const change = useChangePassword();
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [mismatch, setMismatch] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.again) return setMismatch(true);
    setMismatch(false);
    change.mutate(
      { currentPassword: form.current, newPassword: form.next },
      { onSuccess: () => navigate({ to: safeReturnPath(returnUrl) ?? PATHS.dashboard }) },
    );
  };

  const error = mismatch
    ? 'Mật khẩu nhập lại không khớp'
    : change.error instanceof ApiError ? change.error.messages : change.error ? 'Không kết nối được máy chủ' : '';

  return (
    <AuthShell title="Đổi mật khẩu" description="Bạn cần đặt mật khẩu mới trước khi tiếp tục">
      <form onSubmit={submit} className="grid gap-4">
        <FormField id="current" label="Mật khẩu hiện tại" type="password" required
          value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        <FormField id="next" label="Mật khẩu mới (tối thiểu 8 ký tự, có chữ số)" type="password" required minLength={8}
          value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        <FormField id="again" label="Nhập lại mật khẩu mới" type="password" required
          value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={change.isPending}>Lưu mật khẩu</Button>
      </form>
    </AuthShell>
  );
}
