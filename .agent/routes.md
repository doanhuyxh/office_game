# Route API và trang front-end

> Nguồn sự thật: `MapEndpoints` của từng module, `frontend/src/routes/router.tsx`. Kiến trúc chung: [architecture.md](architecture.md). Về [AGENTS.md](../AGENTS.md).

## Route API

| Tiền tố | Module | Tài liệu |
|---|---|---|
| `/api/auth/*` | Identity | [business/auth.md](business/auth.md) |
| `/api/org/*` | Organization | [business/organization.md](business/organization.md), hồ sơ cá nhân `/api/org/profile/*` [business/profile.md](business/profile.md) |
| `/api/attendance/*` | Attendance | [business/attendance.md](business/attendance.md), [business/attendance-corrections.md](business/attendance-corrections.md), [business/attendance-overtime.md](business/attendance-overtime.md) |
| `/api/notifications/*` | Notification | [business/notifications.md](business/notifications.md) |
| `/api/contracts/*` | LaborContracts | [business/contracts.md](business/contracts.md), ký điện tử [business/contracts-esign.md](business/contracts-esign.md) |
| `/api/payroll/*` | Payroll (bảng lương, phiếu lương) | [business/payroll.md](business/payroll.md) |
| `/api/approval/*` | Approval | [business/approval.md](business/approval.md) |
| `/api/leave/*` | Leave | [business/leave.md](business/leave.md) |
| `/mcp`, `/.well-known/oauth-*` | host OfficeHub.Mcp (máy chủ MCP cho AI, gọi lại `/api/*` bằng token; OAuth discovery) | [business/mcp.md](business/mcp.md) |
| `/api/oauth/*` | Identity (OAuth cho ứng dụng AI) | [business/mcp-oauth.md](business/mcp-oauth.md) |
| `/rt/hub/office`, `/rt/voice/token` | Realtime | [business/office.md](business/office.md) |
| `/api/system/info`, `/api/system/storage`, `/api/system/docs/`, `/api/system/openapi/v1.json` | Host Api (`SystemEndpoints.cs`, `StorageReport.cs`) — chỉ `AuthPolicies.Admin`, ngoài allowlist token AI: link tài liệu API / log / mail, cấu hình SMTP (không mật khẩu), tình trạng Postgres / S3 / SMTP, báo cáo dung lượng S3 (quét object dưới `S3__KeyPrefix` ở BucketFiles / Backup / Web, gom theo thư mục, giữ 10 phút, `?refresh=true` quét lại; FE tải CSV). Trang `/system` chia tab (`?tab=`): Tổng quan (link, tình trạng dịch vụ, máy chủ) · Email (SMTP) · Lưu trữ S3 (mở tab là quét) — thêm báo cáo hệ thống mới = thêm mục vào `TABS` trong `features/system/components/system-page`. Link (tài liệu API / log / hộp thư) có nút **"Xem trong trang"** (iframe trong hộp thoại) khi trang đích cho nhúng: Api kiểm tra header `X-Frame-Options` / CSP `frame-ancestors` (`EmbedCheck.cs`, giữ 10 phút; test `EmbedCheckTests`) → `embeddable` true / false / null (chưa kiểm tra được → "Thử xem trong trang"). Gmail chặn nhúng. nginx: `/api/system/docs/` dùng `nginx-security-headers-sameorigin.conf` (SAMEORIGIN) để chính OfficeHub nhúng được, phần còn lại vẫn DENY | [env.md](env.md) (`SystemTools__*`) |
| `/api/audit/ai-requests`, `/api/audit/changes` | Audit (nhật ký AI, lịch sử sửa) | [business/mcp-oauth.md](business/mcp-oauth.md), [business/audit.md](business/audit.md) |
| `/api/reports/*` | Reporting (Excel, tiền tăng ca / phép) | [business/reports.md](business/reports.md) |
| `/api/meetings/*` | Meetings (đặt phòng họp) | [business/meetings.md](business/meetings.md) |
| `/api/documents/*` | Documents (kho tài liệu, dự án; `/admin/*` chỉ HR) | [business/documents.md](business/documents.md) |

## Trang front-end (`routes/router.tsx`)

| Path | Guard | Component (barrel) |
|---|---|---|
| `/login`, `/forgot-password` | `guestOnly` (đã đăng nhập → `/`) | `LoginForm`, `ForgotPasswordForm` (`@/features/auth`) |
| `/accept-invite`, `/reset-password` | không (link email, search `uid`, `token`) | `AcceptInviteForm`, `ResetPasswordForm` |
| `/change-password` | `requireSession` | `ChangePasswordForm` |
| `/office` | `requireAuth`, toàn màn hình | `OfficeView` (`@/features/office`, lazy, kéo Three.js) |
| `/oauth/authorize` | `requireAuth`, toàn màn hình | `OAuthConsentPage` (`@/features/ai-access`) — trang đồng ý cho ứng dụng AI |
| `/` `/attendance` `/employees` `/leave` `/approvals` `/meetings` `/documents` `/contracts` `/payroll` `/payslips` `/profile` `/notifications` `/reports` `/audit` `/ai-access` `/system` | `requireAuth`, trong `MainLayout` (`/system` chỉ admin — PAGE_ROLES) | `Dashboard`, `AttendancePage`, `EmployeesPage`, `LeavePage`, `ApprovalsPage`, `MeetingsPage`, `DocumentsPage`, `ContractsPage`, `PayrollPage`, `PayslipsPage`, `ProfilePage`, `NotificationsPage`, `ReportsPage`, `AuditPage`, `AiAccessPage`, `SystemPage` |

`requireAuth`: chưa đăng nhập → `/login?returnUrl=…`; `mustChangePassword` → `/change-password`. Quay lại sau đăng nhập dùng `safeReturnPath` (chỉ đường dẫn cùng origin). Mọi trang trong `page(...)` là lazy chunk; Three.js tách chunk `three` (`vite.config.ts` `manualChunks`). **Trang theo vai trò: `config/access.ts` → `PAGE_ROLES`** (nguồn duy nhất): Bảng lương, Báo cáo, Lịch sử thay đổi = admin/hr. Menu sidebar / ⌘K (`useNavigation`) ẩn mục không đủ quyền; route trong `PAGE_ROLES`: `page(...)` thêm `beforeLoad` kiểm tra `context.me.roles` → sai vai trò ném `notFound({ data: { forbidden: true } })` → `notFoundComponent` của route `main` hiện `components/feedback/Forbidden.tsx` (giữ URL, không tải chunk trang, không gọi API). **Đừng bọc component lazy của route** trong component khác (React lỗi `use()` khi suspend). URL lạ → `NotFoundPage` (`defaultNotFoundComponent`). Trang khác ai cũng vào, nội dung lọc theo vai trò bên trong (Hợp đồng: nhân viên chỉ xem của mình). Query bị 403 → toast "Bạn không có quyền xem dữ liệu này" (gộp 1 lần, không retry — `App.tsx`). Chỉ là lớp giao diện, quyền thật ở back-end. Bố cục khung trang: [frontend.md](frontend.md#bố-cục-mainlayout).

