# Kiến trúc

> Nguồn sự thật là code. Về [AGENTS.md](../AGENTS.md). Thiết kế dài hạn (cả phần chưa làm) ở `docs/ARCHITECTURE_V2.md` — tài liệu đó là **kế hoạch**, file này mô tả **code đang chạy**.

## Cây thư mục (rút gọn)

```
backend/                         ASP.NET Core .NET 10 — solution OfficeHub.slnx
  src/OfficeHub.Api/             host REST: Program.cs liệt kê IModule[]; /api/*, /health, /openapi, /scalar
  src/OfficeHub.Realtime/        host SignalR: Hubs/OfficeRoomHub.cs, Simulation/(OfficeMap, Presence, OfficeLoop), Voice/
  src/BuildingBlocks/OfficeHub.BuildingBlocks/
    Configuration/               EnvLoader (.env), Settings.cs, AddValidatedOptions
    Hosting/HostingExtensions.cs AddOfficeHubDefaults (Serilog→Seq, Sentry, DataProtection, ForwardedHeaders), S3, Email
    Auth/                        AuthCookie (cookie dùng chung), Roles, ClaimNames, AuthPolicies
    Health/, Http/Validation.cs, Persistence/, Storage/(IFileStorage→S3), Email/(IEmailSender→SMTP), Office/OfficeNetwork
  src/Modules/                   Identity · Organization · Attendance · Approval · Leave · Notification (mỗi cái + .Contracts) ← có nghiệp vụ
                                 LaborContracts · Reporting · Audit ← chỉ khung (/_status)
  tests/                         OfficeHub.Architecture.Tests, OfficeHub.Modules.{Attendance,Leave,Notification}.Tests
frontend/                        React 19 + Vite + TS (bun) — chi tiết: conventions.md
shared/office-map.json           bản đồ văn phòng 3D, dùng chung FE (vẽ) + Realtime (kiểm tra sàn)
infra/                           docker-compose.dev.yml, docker-compose.yml (prod), backup/, livekit/
docs/ARCHITECTURE_V2.md          thiết kế + lộ trình (người đọc)
```

## Ranh giới và luồng request

```
Trình duyệt (SPA :5173)
  ├─ /api/*  ──(Vite proxy dev | Traefik prod)──▶ OfficeHub.Api ─▶ <M>Module endpoints ─▶ DbContext (schema riêng) ─▶ PostgreSQL
  │                                                     └─▶ IAccountService / IEmployeeDirectory (Contracts) giữa các module
  └─ /rt/*   ──(WebSocket)──────────────────────────▶ OfficeHub.Realtime ─▶ Presence (RAM) — không ghi DB
                                                          └─▶ HTTP GET Api /api/auth/me (kiểm tra phiên, cookie người dùng)
```

- FE và API **cùng origin** (dev: Vite proxy; prod: Traefik) → cookie đăng nhập dùng được cho cả `/api` và `/rt`, không cần CORS.
- **Cookie dùng chung 2 host**: Api cấp cookie `officehub.auth` (scheme `Identity.Application`); Realtime đọc lại nhờ cùng scheme, cùng tên cookie, cùng thư mục khoá `DataProtection__KeysPath`, application name `OfficeHub` (`AuthCookie.cs`, `HostingExtensions.cs`).
- Không có message bus: module gọi nhau đồng bộ qua interface trong `*.Contracts` (DI scope cùng request): `IAccountService` (Identity), `IEmployeeDirectory` (Organization), `IApprovalService` + `IApprovalHandler` (Approval ← Leave, Attendance), `ILeaveCalendar` (Leave → Attendance), `IWorkCalendar` (Attendance → Leave). Realtime ↔ Api chỉ có một đường: Realtime gọi `/api/auth/me` ([business/office.md](business/office.md)).
- FE: mọi query/mutation trả **401** → `onUnauthorized` (`App.tsx`) xoá cache và chuyển `/login?returnUrl=…`; query không retry khi 401.
- Business logic nằm ở back-end. FE chỉ hiển thị và điều hướng; `routes/guards.ts` và menu theo vai trò **không phải** lớp bảo mật.
- IP client: Api dùng `ForwardedHeaders` (tin mọi proxy) → `HttpContext.Connection.RemoteIpAddress` là IP thật sau Traefik. Dev qua Vite proxy → IP là localhost.

## Host Api

`Program.cs` thứ tự: `EnvLoader.Load()` → `AddOfficeHubDefaults` → `AddOfficeHubFileStorage` → `AddOfficeHubEmail` → `AddOfficeHubAuthorization` → module `Register` → `UseOfficeHubDefaults` (ForwardedHeaders, ExceptionHandler, `/health`, `/health/ready`) → `UseAuthentication` → `UseAuthorization` → `UseRateLimiter` → `/api` group → module `MapEndpoints`.

Hosted service khởi động: `IdentitySeeder` (migrate + roles + admin), `OrgMigrator`, `AttendanceSeeder` (migrate + ca mặc định).

## Route API

| Tiền tố | Module | Tài liệu |
|---|---|---|
| `/api/auth/*` | Identity | [business/auth.md](business/auth.md) |
| `/api/org/*` | Organization | [business/organization.md](business/organization.md) |
| `/api/attendance/*` | Attendance | [business/attendance.md](business/attendance.md), [business/attendance-corrections.md](business/attendance-corrections.md), [business/attendance-overtime.md](business/attendance-overtime.md) |
| `/api/notifications/*` | Notification | [business/notifications.md](business/notifications.md) |
| `/api/approval/*` | Approval | [business/approval.md](business/approval.md) |
| `/api/leave/*` | Leave | [business/leave.md](business/leave.md) |
| `/rt/hub/office`, `/rt/voice/token` | Realtime | [business/office.md](business/office.md) |
| `/api/contracts`, `/api/reports`, `/api/audit` | khung | chỉ `GET /_status` |

## Trang front-end (`routes/router.tsx`)

| Path | Guard | Component (barrel) |
|---|---|---|
| `/login`, `/forgot-password` | `guestOnly` (đã đăng nhập → `/`) | `LoginForm`, `ForgotPasswordForm` (`@/features/auth`) |
| `/accept-invite`, `/reset-password` | không (link email, search `uid`, `token`) | `AcceptInviteForm`, `ResetPasswordForm` |
| `/change-password` | `requireSession` | `ChangePasswordForm` |
| `/office` | `requireAuth`, toàn màn hình | `OfficeView` (`@/features/office`, lazy, kéo Three.js) |
| `/` `/attendance` `/employees` `/leave` `/approvals` `/contracts` `/reports` | `requireAuth`, trong `MainLayout` | `Dashboard`, `AttendancePage`, `EmployeesPage`, `LeavePage`, `ApprovalsPage`; contracts/reports là `ComingSoon` |

`requireAuth`: chưa đăng nhập → `/login?returnUrl=…`; `mustChangePassword` → `/change-password`. Quay lại sau đăng nhập dùng `safeReturnPath` (chỉ đường dẫn cùng origin). Mọi trang trong `page(...)` là lazy chunk; Three.js tách chunk `three` (`vite.config.ts` `manualChunks`). Menu sidebar (nhóm → mục, icon lucide) lọc theo `roles` trong `components/layout/navigation.ts` (Hợp đồng, Báo cáo: admin/hr; còn lại ai cũng thấy). Bố cục khung trang: [frontend.md](frontend.md#bố-cục-mainlayout).

## Dữ liệu phía client & cache

- `QueryClient` (`App.tsx`): `retry: 1`, `refetchOnWindowFocus: false`.
- Query key gốc theo module, mutation invalidate cả nhánh:

| Key | Nơi | Ghi chú |
|---|---|---|
| `['auth','me']` | `features/auth/api/auth.api.ts` (`authKeys`) | `staleTime` 60s; null = chưa đăng nhập; guard gọi `queryClient.fetchQuery(meQuery)` |
| `['org', …]` | `features/employees/api/org.api.ts` (`orgKeys`) | mọi mutation org → invalidate `['org']` |
| `['attendance', …]` | `features/attendance/api/attendance.api.ts` (`attendanceKeys`) | `today`, `board` tự refetch 60s; `useCheck` ghi thẳng `today` rồi invalidate phần còn lại |
| `['leave', …]` | `features/leave/api/leave.api.ts` (`leaveKeys`) | gửi đơn / điều chỉnh → invalidate `['leave']` + `['approval']` |
| `['approval', …]` | `features/approvals/api/approval.api.ts` (`approvalKeys`) | inbox count refetch 60s; duyệt / từ chối / huỷ → invalidate `approval`, `leave`, `attendance` |

- Đăng xuất (`useLogout`): `me` = null, xoá mọi query khác, về `/login`.
- Không có cache phía server (không Redis). Bảng công tính lại mỗi lần đọc ([business/attendance.md](business/attendance.md)).

## Hạ tầng & tích hợp

- **PostgreSQL**: mỗi module một schema ([database.md](database.md)).
- **S3** (`IFileStorage`, AWSSDK.S3): key = `{S3__KeyPrefix}files/<key>`, đọc qua presigned URL. **Chưa module nào gọi upload** (cần xác nhận khi làm hợp đồng/avatar).
- **SMTP** (`IEmailSender`, MailKit): chỉ Identity dùng (mời, quên mật khẩu).
- **LiveKit**: chỉ cấp token (`/rt/voice/token`); FE chưa có UI voice.
- **Log**: Serilog → console + Seq; Sentry bật khi có DSN.
