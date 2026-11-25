import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { guestOnly, requireAuth, requireSession, requireTwoFactorSetup } from '@/routes/guards';
import { MainLayout } from '@/components/layout/MainLayout';
import { Spinner } from '@/components/feedback/Spinner';
import { AcceptInviteForm, ChangePasswordForm, ForgotPasswordForm, LoginForm, ResetPasswordForm, TwoFactorSetupPage } from '@/features/auth';
import { PATHS } from '@/config/paths';
import { Forbidden } from '@/components/feedback/Forbidden';
import { NotFoundPage } from '@/components/feedback/NotFoundPage';
import { ErrorPage } from '@/components/feedback/error-page';
import { canAccessPage, PAGE_ROLES } from '@/config/access';

/**
 * Định tuyến. Mỗi màn hình là một feature trong src/features/<feature> — route import trang qua '@/features/<feature>/page'
 * (page.ts chỉ export trang; index.ts không export trang, để layout import hook từ barrel không kéo trang vào bundle chính — TEST-113).
 * Thêm màn hình mới: tạo features/<x> (+ index.ts, page.ts) → thêm 1 dòng `page(...)` bên dưới → thêm menu ở components/layout/navigation.ts.
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
// Link tải tệp từ thiết bị khác (TEST-175): trang công khai riêng, ngoài layout đăng nhập — chỉ cần token trong đường dẫn.
const uploadLink = createRoute({
  getParentRoute: () => root,
  path: PATHS.uploadLink,
  component: lazyRouteComponent(() => import('@/features/upload-link/page'), 'UploadLinkPage'),
});

// Trang sổ tay chia sẻ công khai (TEST-229): ngoài layout đăng nhập, gói tải riêng — chọn trang bằng `?page=`.
const wikiShare = createRoute({
  getParentRoute: () => root,
  path: PATHS.wikiShare,
  validateSearch: (s: Record<string, unknown>): { page?: string } => ({ page: typeof s.page === 'string' && s.page ? s.page : undefined }),
  component: lazyRouteComponent(() => import('@/features/wiki-share/page'), 'WikiSharePage'),
});

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
  component: lazyRouteComponent(() => import('@/features/office/page'), 'OfficePage'),
});

// Trang đồng ý cấp quyền cho ứng dụng AI (OAuth) — toàn màn hình. Tham số OAuth đọc thẳng từ URL.
const oauthAuthorize = createRoute({
  getParentRoute: () => protectedRoute,
  path: PATHS.oauthAuthorize,
  component: lazyRouteComponent(() => import('@/features/ai-access/page'), 'OAuthConsentPage'),
});

// Các màn hình nhân sự: dùng chung sidebar.
// notFoundComponent: trang con ném notFound({ data: { forbidden: true } }) khi sai vai trò → "không có quyền"; còn lại là 404 thật.
// errorComponent: lỗi khi render / tải một màn hình → trang lỗi tiếng Việt trong khung trang, vẫn giữ sidebar / header (TEST-67).
const main = createRoute({
  getParentRoute: () => protectedRoute, id: 'main', component: MainLayout,
  errorComponent: ({ error }) => <ErrorPage error={error} />,
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

// Một bài trên Bảng tin (link từ email / chuông): /news/<id>?comment=<id bình luận>
const newsPost = createRoute({
  getParentRoute: () => main,
  path: '/news/$postId',
  validateSearch: (s: Record<string, unknown>): { comment?: string } => ({ comment: typeof s.comment === 'string' ? s.comment : undefined }),
  component: lazyRouteComponent(() => import('@/features/news/page'), 'PostPage'),
});

// Chi tiết dự án (link từ chuông giao việc / thêm thành viên): /projects/<id>?tab=tasks|milestones|members|effort
// ?task=<id việc> mở luôn hộp thoại việc, &comment=<id bình luận> cuộn tới bình luận (TEST-66)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const projectDetail = createRoute({
  getParentRoute: () => main,
  path: '/projects/$projectId',
  validateSearch: (s: Record<string, unknown>): { tab?: string; task?: string; comment?: string } => ({ tab: str(s.tab), task: str(s.task), comment: str(s.comment) }),
  component: lazyRouteComponent(() => import('@/features/projects/page'), 'ProjectDetailPage'),
});

// Link cũ /social (chuông / email trước TEST-207) → trang Facebook. Mỗi nền tảng MXH một trang: /social/<nền tảng> (config/social-platforms.ts).
const socialLegacy = createRoute({
  getParentRoute: () => main,
  path: PATHS.social,
  beforeLoad: () => { throw redirect({ to: PATHS.socialFacebook, replace: true }); },
});

const routeTree = root.addChildren([
  login,
  changePassword,
  setupTwoFactor,
  forgotPassword,
  acceptInvite,
  resetPassword,
  uploadLink,
  wikiShare,
  protectedRoute.addChildren([
    office,
    oauthAuthorize,
    main.addChildren([
      page(PATHS.dashboard, () => import('@/features/dashboard/page'), 'Dashboard'),
      page(PATHS.attendance, () => import('@/features/attendance/page'), 'AttendancePage'),
      page(PATHS.leave, () => import('@/features/leave/page'), 'LeavePage'),
      page(PATHS.approvals, () => import('@/features/approvals/page'), 'ApprovalsPage'),
      page(PATHS.meetings, () => import('@/features/meetings/page'), 'MeetingsPage'),
      page(PATHS.documents, () => import('@/features/documents/page'), 'DocumentsPage'),
      page(PATHS.assets, () => import('@/features/assets/page'), 'AssetsPage'),
      socialLegacy,
      page(PATHS.socialFacebook, () => import('@/features/social/page'), 'FacebookPostsPage'),
      page(PATHS.socialFacebookPage, () => import('@/features/social/page'), 'FacebookPageDetailPage'),
      page(PATHS.socialZaloOa, () => import('@/features/social/page'), 'ZaloOaPage'),
      page(PATHS.socialTiktok, () => import('@/features/social/page'), 'TiktokPage'),
      page(PATHS.finance, () => import('@/features/finance/page'), 'FinancePage'),
      page(PATHS.sales, () => import('@/features/sales/page'), 'SalesPage'),
      page(PATHS.projects, () => import('@/features/projects/page'), 'ProjectsPage'),
      page(PATHS.employees, () => import('@/features/employees/page'), 'EmployeesPage'),
      page(PATHS.contracts, () => import('@/features/contracts/page'), 'ContractsPage'),
      page(PATHS.reports, () => import('@/features/reports/page'), 'ReportsPage'),
      page(PATHS.audit, () => import('@/features/audit/page'), 'AuditPage'),
      page(PATHS.payroll, () => import('@/features/payroll/page'), 'PayrollPage'),
      page(PATHS.payslips, () => import('@/features/payroll/page'), 'PayslipsPage'),
      page(PATHS.profile, () => import('@/features/profile/page'), 'ProfilePage'),
      page(PATHS.notifications, () => import('@/features/notifications/page'), 'NotificationsPage'),
      page(PATHS.chat, () => import('@/features/chat/page'), 'ChatPage'),
      page(PATHS.news, () => import('@/features/news/page'), 'NewsPage'),
      newsPost,
      projectDetail,
      page(PATHS.aiAccess, () => import('@/features/ai-access/page'), 'AiAccessPage'),
      page(PATHS.mcpTools, () => import('@/features/mcp-tools/page'), 'McpToolsPage'),
      page(PATHS.system, () => import('@/features/system/page'), 'SystemPage'),
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
    // Lỗi ngoài khung trang (đăng nhập, văn phòng 3D…) → trang lỗi toàn màn hình thay "Something went wrong!" mặc định (TEST-67)
    defaultErrorComponent: ({ error }) => <ErrorPage error={error} fullScreen />,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
