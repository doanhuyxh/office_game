import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: (n, err) => !(err instanceof ApiError && err.status === 401) && n < 1, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
});
const router = createAppRouter(queryClient);

/** Root component: bọc Providers & Router. Thêm provider mới (toast, theme, i18n...) ở đây. */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}
