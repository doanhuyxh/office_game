import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { guestOnly, requireAuth, requireSession } from '@/routes/guards';
import { MainLayout } from '@/components/layout/MainLayout';
import { Spinner } from '@/components/feedback/Spinner';
import { AcceptInviteForm, ChangePasswordForm, ForgotPasswordForm, LoginForm, ResetPasswordForm } from '@/features/auth';
import { PATHS } from '@/config/paths';

/**
 * Định tuyến. Mỗi màn hình là một feature trong src/features/<feature> — route import qua barrel '@/features/<feature>'.
 * Thêm màn hình mới: tạo features/<x> (+ index.ts) → thêm 1 dòng `page(...)` bên dưới → thêm menu ở components/layout/navigation.ts.
 * Các feature được lazy load: mỗi màn hình một file JS, chỉ tải khi mở (văn phòng 3D kéo theo Three.js).
 */

const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet });

const returnUrlSearch = (s: Record<string, unknown>): { returnUrl?: string } => ({
  returnUrl: typeof s.returnUrl === 'string' ? s.returnUrl : undefined,
});

// ---- Khách ----
const login = createRoute({
  getParentRoute: () => root,
  path: PATHS.login,
  validateSearch: returnUrlSearch,
  beforeLoad: ({ context }) => guestOnly(context.queryClient),
  component: LoginForm,
});

const changePassword = createRoute({
  getParentRoute: () => root,
  path: PATHS.changePassword,
  validateSearch: returnUrlSearch,
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  component: ChangePasswordForm,
});

const forgotPassword = createRoute({
  getParentRoute: () => root,
  path: PATHS.forgotPassword,
  beforeLoad: ({ context }) => guestOnly(context.queryClient),
  component: ForgotPasswordForm,
});

// Link trong email: ai có link hợp lệ đều mở được (không cần đăng nhập).
const tokenSearch = (s: Record<string, unknown>): { uid?: string; token?: string } => ({
  uid: typeof s.uid === 'string' ? s.uid : undefined,
  token: typeof s.token === 'string' ? s.token : undefined,
});
const acceptInvite = createRoute({ getParentRoute: () => root, path: PATHS.acceptInvite, validateSearch: tokenSearch, component: AcceptInviteForm });
const resetPassword = createRoute({ getParentRoute: () => root, path: PATHS.resetPassword, validateSearch: tokenSearch, component: ResetPasswordForm });

// ---- Cần đăng nhập ----
const protectedRoute = createRoute({
  getParentRoute: () => root,
  id: 'protected',
  beforeLoad: async ({ context, location }) => ({ me: await requireAuth(context.queryClient, location.href) }),
  component: Outlet,
});

// Văn phòng 3D: toàn màn hình, không có sidebar.
const office = createRoute({
  getParentRoute: () => protectedRoute,
  path: PATHS.office,
  component: lazyRouteComponent(() => import('@/features/office'), 'OfficeView'),
});

// Các màn hình nhân sự: dùng chung sidebar.
const main = createRoute({ getParentRoute: () => protectedRoute, id: 'main', component: MainLayout });

// Generic theo path để TanStack Router biết chính xác các đường dẫn (Link to={PATHS.x} được kiểm tra kiểu).
const page = <const P extends string>(path: P, load: Parameters<typeof lazyRouteComponent>[0], exportName: string) =>
  createRoute({ getParentRoute: () => main, path, component: lazyRouteComponent(load, exportName) });

const routeTree = root.addChildren([
  login,
  changePassword,
  forgotPassword,
  acceptInvite,
  resetPassword,
  protectedRoute.addChildren([
    office,
    main.addChildren([
      page(PATHS.dashboard, () => import('@/features/dashboard'), 'Dashboard'),
      page(PATHS.attendance, () => import('@/features/attendance'), 'AttendancePage'),
      page(PATHS.leave, () => import('@/features/leave'), 'LeavePage'),
      page(PATHS.approvals, () => import('@/features/approvals'), 'ApprovalsPage'),
      page(PATHS.employees, () => import('@/features/employees'), 'EmployeesPage'),
      page(PATHS.contracts, () => import('@/features/contracts'), 'ContractsPage'),
      page(PATHS.reports, () => import('@/features/reports'), 'ReportsPage'),
    ]),
  ]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPendingComponent: Spinner, // hiện khi đang tải chunk của màn hình (lazy)
    defaultPendingMs: 200,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
