import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { ThemeProvider } from '@/context/theme-provider';
import { toast } from 'sonner';
import { Toaster } from '@/components/common/sonner';
import { authKeys } from '@/features/auth';
import { PATHS } from '@/config/paths';
import { ApiError } from '@/services/api-client';
import { createAppRouter } from '@/routes/router';

/**
 * Phiên hết hiệu lực giữa chừng (bị khoá, nghỉ việc, HR cấp lại mật khẩu…) → API trả 401
 * → xoá dữ liệu người dùng và chuyển về trang đăng nhập (giữ returnUrl).
 */
function onUnauthorized(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  if (location.pathname === PATHS.login) return;
  queryClient.setQueryData(authKeys.me, null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== authKeys.me[0] });
  void router.navigate({ to: PATHS.login, search: { returnUrl: location.pathname + location.search } });
}

/**
 * Admin / HR chưa bật 2FA (vd vừa được cấp vai trò, hoặc bị HR đặt lại 2FA): API trả 403 `2fa_setup_required`
 * → chuyển sang trang bật 2FA thay vì hiện toast lỗi ở từng request. Trả true nếu đã xử lý.
 */
function onTwoFactorRequired(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 403 || err.problem.title !== '2fa_setup_required') return false;
  if (location.pathname !== PATHS.setupTwoFactor) {
    void queryClient.invalidateQueries({ queryKey: authKeys.me });
    void router.navigate({ to: PATHS.setupTwoFactor, search: { returnUrl: location.pathname + location.search } });
  }
  return true;
}

/** Đọc dữ liệu bị 403 (không có quyền) → báo rõ một lần, tránh để trang hiện "chưa có dữ liệu" gây hiểu nhầm. Mutation đã có errorMessage. */
function onQueryError(err: unknown) {
  onUnauthorized(err);
  if (onTwoFactorRequired(err)) return;
  if (err instanceof ApiError && err.status === 403)
    toast.error(err.problem.detail ?? 'Bạn không có quyền xem dữ liệu này', { id: 'forbidden' });
}

const queryClient = new QueryClient({
  // 401 / 403 không thử lại (kết quả không đổi)
  defaultOptions: { queries: { retry: (n, err) => !(err instanceof ApiError && (err.status === 401 || err.status === 403)) && n < 1, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: onQueryError }),
  mutationCache: new MutationCache({ onError: (err) => { onUnauthorized(err); onTwoFactorRequired(err); } }),
});
const router = createAppRouter(queryClient);

/** Root component: bọc Providers & Router. Thêm provider mới (toast, theme, i18n...) ở đây. */
export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
