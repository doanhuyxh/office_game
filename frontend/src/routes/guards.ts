import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import { meQuery, type IMe } from '@/features/auth';
import { PATHS } from '@/config/paths';

/**
 * Chặn route theo trạng thái đăng nhập (ProtectedRoute). Gọi trong beforeLoad.
 * Server vẫn là nơi kiểm tra quyền thật — đây chỉ để điều hướng.
 */

/** Cần đăng nhập: chưa đăng nhập → /login, mật khẩu tạm → /change-password. */
export async function requireAuth(queryClient: QueryClient, href: string): Promise<IMe> {
  const me = await queryClient.fetchQuery(meQuery);
  if (!me) throw redirect({ to: PATHS.login, search: { returnUrl: href } });
  if (me.mustChangePassword) throw redirect({ to: PATHS.changePassword, search: { returnUrl: href } });
  return me;
}

/** Chỉ cần có phiên (kể cả đang dùng mật khẩu tạm). */
export async function requireSession(queryClient: QueryClient): Promise<IMe> {
  const me = await queryClient.fetchQuery(meQuery);
  if (!me) throw redirect({ to: PATHS.login });
  return me;
}

/** Trang dành cho khách: đã đăng nhập thì về trang chủ. */
export async function guestOnly(queryClient: QueryClient) {
  const me = await queryClient.fetchQuery(meQuery);
  if (me && !me.mustChangePassword) throw redirect({ to: PATHS.dashboard });
}
