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
| `/api/approval/*` | Approval (`/delegations` = uỷ quyền duyệt) | [business/approval.md](business/approval.md), [business/approval-delegation.md](business/approval-delegation.md) |
| `/api/leave/*` | Leave | [business/leave.md](business/leave.md) |
| `/mcp`, `/.well-known/oauth-*` | host OfficeHub.Mcp (máy chủ MCP cho AI, gọi lại `/api/*` bằng token; OAuth discovery) | [business/mcp.md](business/mcp.md) |
| `/api/oauth/*` | Identity (OAuth cho ứng dụng AI) | [business/mcp-oauth.md](business/mcp-oauth.md) |
| `/rt/hub/office`, `/rt/voice/token` | Realtime | [business/office.md](business/office.md) |
| `/rt/hub/chat` | Realtime (`ChatHub`, tin nhắn cho cả web) | [business/chat.md](business/chat.md) |
| `/api/system/info`, `/api/system/storage`, `/api/system/ops` (+ POST `ops/email/retry`), `/api/system/docs/`, `/api/system/openapi/v1.json` | Host Api (`SystemEndpoints.cs`, `StorageReport.cs`) — chỉ `AuthPolicies.Admin`, ngoài allowlist token AI: link tài liệu API / log / mail, cấu hình SMTP (không mật khẩu), tình trạng Postgres / S3 / SMTP, báo cáo dung lượng S3 (quét object dưới `S3__KeyPrefix` ở BucketFiles / Backup / Web, gom theo thư mục, giữ 10 phút, `?refresh=true` quét lại; FE tải CSV). Trang `/system` chia tab (`?tab=`): Tổng quan (link, tình trạng dịch vụ, máy chủ) · Email (SMTP) · Lưu trữ S3 (mở tab là quét) · Vận hành (`OpsReport.cs` — xem [ops.md](ops.md)) · Cấu hình (giới hạn trợ lý AI trên bảng việc: `GET / PUT /api/projects/agent-settings`, chỉ admin, ngoài allowlist token AI — [business/agent-team.md](business/agent-team.md)) — thêm báo cáo hệ thống mới = thêm mục vào `TABS` trong `features/system/components/system-page`. Link (tài liệu API / log / hộp thư) có nút **"Xem trong trang"** (iframe trong hộp thoại) khi trang đích cho nhúng: Api kiểm tra header `X-Frame-Options` / CSP `frame-ancestors` (`EmbedCheck.cs`, giữ 10 phút; test `EmbedCheckTests`) → `embeddable` true / false / null (chưa kiểm tra được → "Thử xem trong trang"). Gmail chặn nhúng. nginx: `/api/system/docs/` dùng `nginx-security-headers-sameorigin.conf` (SAMEORIGIN) để chính OfficeHub nhúng được, phần còn lại vẫn DENY | [env.md](env.md) (`SystemTools__*`) |
| `/api/audit/ai-requests`, `/api/audit/ai-usage`, `/api/audit/changes` | Audit (nhật ký AI, báo cáo sử dụng AI, lịch sử sửa) | [business/mcp-oauth.md](business/mcp-oauth.md), [business/audit.md](business/audit.md) |
| `/api/reports/*` | Reporting (Excel, tiền tăng ca / phép) | [business/reports.md](business/reports.md) |
| `/api/meetings/*` | Meetings (đặt phòng họp) | [business/meetings.md](business/meetings.md) |
| `/api/documents/*` | Documents (kho tài liệu, dự án; `/admin/*` chỉ HR) | [business/documents.md](business/documents.md) |
| `/api/projects/*` | Projects (dự án, thành viên, phân bổ, ngày công, mốc, việc, bình luận; thấy: thành viên / HR / quyền Xem tài chính; token AI bị chặn). `/api/documents/projects*` đã bỏ | [business/projects.md](business/projects.md) |
| `/api/sales/*` | Sales (khách, cơ hội, hợp đồng bán, đợt thu, công nợ; thấy theo người phụ trách + cấp dưới + quyền Xem tài chính; token AI bị chặn) | [business/sales.md](business/sales.md) |
| `/api/finance/*` | Finance (quỹ, sổ thu chi, khoá sổ, đề nghị chi; quyền theo **chức vụ** qua `RequireFinance`, không theo vai trò; token AI bị chặn) | [business/finance.md](business/finance.md) |
| `/api/assets/*` | Assets (thiết bị, dịch vụ / ghế, rà soát quyền, kiểm kê, Excel, biên bản, ảnh / hoá đơn; ghi = `AuthPolicies.Hr`, trừ xác nhận biên bản) · `/api/assets/social/*` (BM Facebook = HR; trang / bài = HR + người giữ BM) | [business/assets.md](business/assets.md), [business/assets-review.md](business/assets-review.md), [business/assets-handover.md](business/assets-handover.md), [business/assets-social.md](business/assets-social.md) |
| `/api/chat/*` | Chat (kênh Office / phòng / 1-1, tệp đính kèm; `/internal/*` chỉ Realtime, khoá `X-Chat-Key`; ngoài allowlist token AI) | [business/chat.md](business/chat.md) |
| `/api/news/*` | Bảng tin (bài viết + bình luận + cảm xúc; `/admin/*` = `AuthPolicies.Hr`; token AI **chỉ** `GET /feed` và `GET /posts/*`) | [business/news.md](business/news.md) |

## Trang front-end (`routes/router.tsx`)

| Path | Guard | Component (barrel) |
|---|---|---|
| `/login`, `/forgot-password` | `guestOnly` (đã đăng nhập → `/`) | `LoginForm`, `ForgotPasswordForm` (`@/features/auth`) |
| `/accept-invite`, `/reset-password` | không (link email, search `uid`, `token`) | `AcceptInviteForm`, `ResetPasswordForm` |
| `/change-password` | `requireSession` | `ChangePasswordForm` |
| `/setup-2fa` | `requireTwoFactorSetup` (phiên; mật khẩu tạm → `/change-password` trước) | `TwoFactorSetupPage` — bật xác thực 2 lớp ([business/auth-2fa.md](business/auth-2fa.md)) |
| `/office` | `requireAuth`, toàn màn hình | `OfficeView` (`@/features/office`, lazy, kéo Three.js) |
| `/oauth/authorize` | `requireAuth`, toàn màn hình | `OAuthConsentPage` (`@/features/ai-access`) — trang đồng ý cho ứng dụng AI |
| `/` `/attendance` `/employees` `/leave` `/approvals` `/meetings` `/documents` `/assets` `/social` `/projects` `/sales` `/finance` `/contracts` `/payroll` `/payslips` `/profile` `/notifications` `/chat` `/news` `/reports` `/audit` `/ai-access` `/mcp-tools` `/system` | `requireAuth`, trong `MainLayout` (`/mcp-tools` và `/system` chỉ admin; `/reports` admin / hr / manager — PAGE_ROLES) | `Dashboard`, `AttendancePage`, `EmployeesPage`, `LeavePage`, `ApprovalsPage`, `MeetingsPage`, `DocumentsPage`, `AssetsPage` (`features/assets/`: HR 8 tab Tổng quan (mặc định) · Thiết bị · Dịch vụ · MXH · Rà soát · Kiểm kê · Danh mục · Của tôi; người khác chỉ "Của tôi" + khung "Việc cần rà soát"; `?tab=`), `SocialPage` (`features/social/`: soạn + danh sách bài; menu chỉ HR + người giữ BM), `ProjectsPage` + `/projects/$projectId` → `ProjectDetailPage` (`features/projects/`, `?tab=`), `SalesPage` (`features/sales/`: Khách hàng · Cơ hội · Hợp đồng · Công nợ, `?customer=`), `FinancePage` (`features/finance/`: quyền Xem → Tổng quan · Sổ thu chi · Đề nghị chi · Cấu hình; người khác chỉ Đề nghị chi; không PAGE_ROLES — back-end kiểm tra), `ContractsPage`, `PayrollPage`, `PayslipsPage`, `ProfilePage`, `NotificationsPage`, `ChatPage`, `NewsPage` (+ `/news/$postId` → `PostPage`), `ReportsPage`, `AuditPage`, `AiAccessPage`, `McpToolsPage` (danh mục tool MCP, `features/mcp-tools/`), `SystemPage` |

`requireAuth`: chưa đăng nhập → `/login?returnUrl=…`; `mustChangePassword` → `/change-password`; `mustSetupTwoFactor` (admin / hr chưa bật 2FA) → `/setup-2fa`; API trả 403 `2fa_setup_required` → `App.tsx` cũng chuyển sang `/setup-2fa`. Quay lại sau đăng nhập dùng `safeReturnPath` (chỉ đường dẫn cùng origin). Mọi trang trong `page(...)` là lazy chunk; Three.js tách chunk `three` (`vite.config.ts` `manualChunks`). **Trang theo vai trò: `config/access.ts` → `PAGE_ROLES`** (nguồn duy nhất): Bảng lương, Báo cáo, Lịch sử thay đổi = admin/hr. Menu sidebar / ⌘K (`useNavigation`) ẩn mục không đủ quyền; route trong `PAGE_ROLES`: `page(...)` thêm `beforeLoad` kiểm tra `context.me.roles` → sai vai trò ném `notFound({ data: { forbidden: true } })` → `notFoundComponent` của route `main` hiện `components/feedback/Forbidden.tsx` (giữ URL, không tải chunk trang, không gọi API). **Đừng bọc component lazy của route** trong component khác (React lỗi `use()` khi suspend). URL lạ → `NotFoundPage` (`defaultNotFoundComponent`). Trang khác ai cũng vào, nội dung lọc theo vai trò bên trong (Hợp đồng: nhân viên chỉ xem của mình). Query bị 403 → toast "Bạn không có quyền xem dữ liệu này" (gộp 1 lần, không retry — `App.tsx`). Chỉ là lớp giao diện, quyền thật ở back-end. Bố cục khung trang: [frontend.md](frontend.md#bố-cục-mainlayout).

