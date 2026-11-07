import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  Outlet,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { guestOnly, requireAuth, requireSession, requireTwoFactorSetup } from '@/routes/guards';
import { MainLayout } from '@/components/layout/MainLayout';
import { Spinner } from '@/components/feedback/Spinner';
import { AcceptInviteForm, ChangePasswordForm, ForgotPasswordForm, LoginForm, ResetPasswordForm, TwoFactorSetupPage } from '@/features/auth';
import { PATHS } from '@/config/paths';
import { Forbidden } from '@/components/feedback/Forbidden';
import { NotFoundPage } from '@/components/feedback/NotFoundPage';
import { canAccessPage, PAGE_ROLES } from '@/config/access';

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

// Bật xác thực 2 lớp: admin / HR chưa bật bị requireAuth đưa tới đây; người khác vào từ thẻ ở Hồ sơ.
const setupTwoFactor = createRoute({
  getParentRoute: () => root,
  path: PATHS.setupTwoFactor,
  validateSearch: returnUrlSearch,
  beforeLoad: ({ context, location }) => requireTwoFactorSetup(context.queryClient, location.href),
  component: TwoFactorSetupPage,
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

// Trang đồng ý cấp quyền cho ứng dụng AI (OAuth) — toàn màn hình. Tham số OAuth đọc thẳng từ URL.
const oauthAuthorize = createRoute({
  getParentRoute: () => protectedRoute,
  path: PATHS.oauthAuthorize,
  component: lazyRouteComponent(() => import('@/features/ai-access'), 'OAuthConsentPage'),
});

// Các màn hình nhân sự: dùng chung sidebar.
// notFoundComponent: trang con ném notFound({ data: { forbidden: true } }) khi sai vai trò → "không có quyền"; còn lại là 404 thật.
const main = createRoute({
  getParentRoute: () => protectedRoute, id: 'main', component: MainLayout,
  notFoundComponent: ({ data }) => ((data as { forbidden?: boolean } | undefined)?.forbidden ? <Forbidden /> : <NotFoundPage />),
});

// Generic theo path để TanStack Router biết chính xác các đường dẫn (Link to={PATHS.x} được kiểm tra kiểu).
// Trang có trong PAGE_ROLES (config/access.ts): kiểm tra vai trò ở beforeLoad (context.me từ protectedRoute) → sai vai trò ném notFound
// có cờ forbidden (không qua error boundary, giữ URL) → main hiện <Forbidden />; không tải chunk trang, không gọi API.
// Component route vẫn là trang lazy gốc (không bọc) để router preload / suspend đúng cách.
const page = <const P extends string>(path: P, load: Parameters<typeof lazyRouteComponent>[0], exportName: string) =>
  createRoute({
    getParentRoute: () => main, path,
    component: lazyRouteComponent(load, exportName),
    ...(PAGE_ROLES[path] && {
      beforeLoad: ({ context }: { context: { me: { roles: string[] } } }) => {
        if (!canAccessPage(context.me.roles, path)) throw notFound({ data: { forbidden: true } });
      },
    }),
  });

const routeTree = root.addChildren([
  login,
  changePassword,
  setupTwoFactor,
  forgotPassword,
  acceptInvite,
  resetPassword,
  protectedRoute.addChildren([
    office,
    oauthAuthorize,
    main.addChildren([
      page(PATHS.dashboard, () => import('@/features/dashboard'), 'Dashboard'),
      page(PATHS.attendance, () => import('@/features/attendance'), 'AttendancePage'),
      page(PATHS.leave, () => import('@/features/leave'), 'LeavePage'),
      page(PATHS.approvals, () => import('@/features/approvals'), 'ApprovalsPage'),
      page(PATHS.meetings, () => import('@/features/meetings'), 'MeetingsPage'),
      page(PATHS.documents, () => import('@/features/documents'), 'DocumentsPage'),
      page(PATHS.employees, () => import('@/features/employees'), 'EmployeesPage'),
      page(PATHS.contracts, () => import('@/features/contracts'), 'ContractsPage'),
      page(PATHS.reports, () => import('@/features/reports'), 'ReportsPage'),
      page(PATHS.audit, () => import('@/features/audit'), 'AuditPage'),
      page(PATHS.payroll, () => import('@/features/payroll'), 'PayrollPage'),
      page(PATHS.payslips, () => import('@/features/payroll'), 'PayslipsPage'),
      page(PATHS.profile, () => import('@/features/profile'), 'ProfilePage'),
      page(PATHS.notifications, () => import('@/features/notifications'), 'NotificationsPage'),
      page(PATHS.aiAccess, () => import('@/features/ai-access'), 'AiAccessPage'),
      page(PATHS.mcpTools, () => import('@/features/mcp-tools'), 'McpToolsPage'),
      page(PATHS.system, () => import('@/features/system'), 'SystemPage'),
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
    defaultNotFoundComponent: NotFoundPage, // URL lạ (ngoài khung trang) — trong khung trang dùng notFoundComponent của main
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
