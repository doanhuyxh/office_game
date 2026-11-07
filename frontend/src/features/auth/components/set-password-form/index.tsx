import { useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { PATHS } from '@/config/paths';
import { ApiError } from '@/services/api-client';
import { useResetPassword } from '../../hooks/useAuth';
import { AuthShell } from '../auth-shell';

/**
 * Đặt mật khẩu từ link trong email.
 * mode="invite": nhân viên mới nhận lời mời · mode="reset": quên mật khẩu.
 */
export function SetPasswordForm({ mode }: { mode: 'invite' | 'reset' }) {
  const { uid, token } = useSearch({ strict: false }) as { uid?: string; token?: string };
  const reset = useResetPassword();
  const [form, setForm] = useState({ next: '', again: '' });
  const [mismatch, setMismatch] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.next !== form.again) return setMismatch(true);
    setMismatch(false);
    reset.mutate({ userId: uid!, token: token!, newPassword: form.next });
  };

  const title = mode === 'invite' ? 'Chào mừng bạn!' : 'Đặt lại mật khẩu';
  const description = mode === 'invite' ? 'Đặt mật khẩu để bắt đầu sử dụng OfficeHub' : 'Nhập mật khẩu mới cho tài khoản của bạn';

  if (!uid || !token) {
    return (
      <AuthShell title={title} description="Link không hợp lệ">
        <p className="text-center text-sm">Link thiếu thông tin. Hãy mở lại link trong email, hoặc liên hệ HR.</p>
      </AuthShell>
    );
  }

  if (reset.isSuccess) {
    return (
      <AuthShell title="Đã đặt mật khẩu" description="Bạn có thể đăng nhập bằng mật khẩu mới">
        <Link to={PATHS.login} className="block text-center text-primary hover:underline">Đăng nhập →</Link>
      </AuthShell>
    );
  }

  const error = mismatch
    ? 'Mật khẩu nhập lại không khớp'
    : reset.error instanceof ApiError ? reset.error.messages : reset.error ? 'Không kết nối được máy chủ' : '';

  return (
    <AuthShell title={title} description={description}>
      <form onSubmit={submit} className="grid gap-4">
        <FormField id="next" label="Mật khẩu mới (tối thiểu 8 ký tự, có chữ số)" type="password" required minLength={8} autoFocus
          autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        <FormField id="again" label="Nhập lại mật khẩu" type="password" required autoComplete="new-password"
          value={form.again} onChange={(e) => setForm({ ...form, again: e.target.value })} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={reset.isPending}>{reset.isPending ? 'Đang lưu…' : 'Lưu mật khẩu'}</Button>
      </form>
    </AuthShell>
  );
}

export const AcceptInviteForm = () => <SetPasswordForm mode="invite" />;
export const ResetPasswordForm = () => <SetPasswordForm mode="reset" />;
