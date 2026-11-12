# Kiến trúc

> Nguồn sự thật là code. Về [AGENTS.md](../AGENTS.md). Thiết kế dài hạn (cả phần chưa làm) ở `docs/ARCHITECTURE_V2.md` — tài liệu đó là **kế hoạch**, file này mô tả **code đang chạy**.

## Cây thư mục (rút gọn)

```
backend/                         ASP.NET Core .NET 10 — solution OfficeHub.slnx
  src/OfficeHub.Api/             host REST: Program.cs liệt kê IModule[]; /api/*, /health, /openapi, /scalar
  src/OfficeHub.Realtime/        host SignalR: Hubs/OfficeRoomHub.cs, Simulation/(OfficeMap, Presence, OfficeLoop), Voice/
  src/OfficeHub.Mcp/             host MCP (/mcp) cho trợ lý AI: Tools/, Infrastructure/(OfficeHubApi, BearerGate) — không đọc DB
  src/BuildingBlocks/OfficeHub.BuildingBlocks/
    Configuration/               EnvLoader (.env), Settings.cs, AddValidatedOptions
    Hosting/HostingExtensions.cs AddOfficeHubDefaults (Serilog→Seq, Sentry, DataProtection, ForwardedHeaders), S3, Email
    Auth/                        AuthCookie (cookie dùng chung), Roles, ClaimNames, AuthPolicies, TwoFactorGate (admin / HR chưa bật 2FA → 403)
    Health/, Http/Validation.cs, Persistence/, Storage/(IFileStorage→S3), Email/(IEmailSender→SMTP), Security/(IFieldEncryptor AES-GCM), Office/OfficeNetwork
  src/Modules/                   Identity · Organization · Attendance · Approval · Leave · Notification (mỗi cái + .Contracts) · LaborContracts ← có nghiệp vụ
                                 Meetings ← đặt phòng họp · Chat ← tin nhắn (Office / phòng / 1-1, tệp S3 `chat/`) · Reporting ← báo cáo / Excel / quy ra tiền (không DB, chỉ đọc qua *.Contracts)
                                 Audit ← nhật ký AI (IStartupFilter) + lịch sử sửa (IChangeAuditSink ← interceptor [Audited] ở BuildingBlocks)
  tests/                         OfficeHub.Architecture.Tests, OfficeHub.Modules.{Attendance,Leave,Notification,LaborContracts}.Tests, OfficeHub.Modules.Identity.Tests, OfficeHub.{Realtime,Mcp}.Tests
frontend/                        React 19 + Vite + TS (bun) — chi tiết: conventions.md
shared/office-map.json           bản đồ văn phòng 3D, dùng chung FE (vẽ) + Realtime (kiểm tra sàn)
infra/                           docker-compose.dev.yml, docker-compose.yml (prod), backup/, livekit/
docs/ARCHITECTURE_V2.md          thiết kế + lộ trình (người đọc)
```

## Ranh giới và luồng request

```
Trình duyệt (SPA :5173)
  ├─ /api/*  ──(Vite proxy dev | nginx VPS → container web prod)──▶ OfficeHub.Api ─▶ <M>Module endpoints ─▶ DbContext (schema riêng) ─▶ PostgreSQL
  │                                                     └─▶ IAccountService / IEmployeeDirectory (Contracts) giữa các module
  ├─ /mcp    ──(AI client, Bearer ohk_…)──▶ OfficeHub.Mcp ─▶ HTTP /api/* của Api bằng chính token đó (business/mcp.md)
  ├─ /.well-known/oauth-* ─▶ OfficeHub.Mcp (OAuth discovery); /oauth/authorize = trang FE; /api/oauth/* = Identity (business/mcp-oauth.md)
  └─ /rt/*   ──(WebSocket)──────────────────────────▶ OfficeHub.Realtime ─▶ Presence (RAM) — không ghi DB; ChatHub → /api/chat (lưu ở Api)
                                                          └─▶ HTTP GET Api /api/auth/me (kiểm tra phiên, cookie người dùng)
```

- FE và API **cùng origin** (dev: Vite proxy; prod: nginx VPS → container `web` chia `/api`, `/rt`, `/livekit`) → cookie đăng nhập dùng được cho cả `/api` và `/rt`, không cần CORS.
- **Cookie dùng chung 2 host**: Api cấp cookie `officehub.auth` (scheme `Identity.Application`); Realtime đọc lại nhờ cùng scheme, cùng tên cookie, cùng thư mục khoá `DataProtection__KeysPath`, application name `OfficeHub` (`AuthCookie.cs`, `HostingExtensions.cs`).
- **Chống CSRF** (`BuildingBlocks/Security/CsrfGuard.cs`, `UseCsrfGuard()` ở Api sau `UseCors` và ở Realtime trước `UseAuthentication`): request ghi (POST / PUT / PATCH / DELETE) và bắt tay WebSocket phải có `Sec-Fetch-Site` = `same-origin` / `none`; trình duyệt cũ không gửi header đó thì so `Origin` (rồi `Referer`) với `App__BaseUrl` + chính host của request; không có header nào (curl, script e2e) → cho qua. Bỏ qua request có `Authorization` (token AI) và endpoint có CORS riêng (`/api/oauth/register|token|revoke`). Bị chặn → 403 ProblemDetails `title: "csrf"`. Lý do: `SameSite=Lax` vẫn gửi cookie khi trang tấn công cùng site (subdomain khác của cùng tên miền) và form multipart không cần preflight.
- Không có message bus: module gọi nhau đồng bộ qua interface trong `*.Contracts` (DI scope cùng request): `IAccountService` (Identity), `IEmployeeDirectory` (Organization), `IApprovalService` + `IApprovalHandler` (Approval ← Leave, Attendance), `ILeaveCalendar` (Leave → Attendance), `IWorkCalendar` (Attendance → Leave, Reporting), `IAttendanceReports` (Attendance → Reporting), `ILeaveBalances` (Leave → Reporting), `ISalaryLookup` (LaborContracts → Reporting), `INotifier` (→ Meetings…). Realtime ↔ Api: Realtime gọi `/api/auth/me` (kiểm tra phiên) và `/api/chat/*` (lưu tin bằng cookie người dùng; cấp thành viên kênh phòng bằng khoá `Chat__InternalKey`, [business/chat.md](business/chat.md)). Đường nội bộ `/rt/internal/*` (Mcp → Realtime) và `/api/chat/internal/*` (Realtime → Api) chỉ gọi trong mạng Docker: nginx container `web` trả 404 từ ngoài; Realtime kiểm khoá + giới hạn body (4 MB ảnh bot, 64 KB còn lại) ở middleware `UseInternalRouteGuard` **trước** khi đọc body; Api giới hạn 16 KB (TEST-18) ([business/office.md](business/office.md)). Mcp ↔ Api: Mcp gọi `/api/*` với Bearer token của người dùng, Api chỉ cho các route trong `AccessTokenAuth.IsAllowed` ([business/mcp.md](business/mcp.md)).
- FE: mọi query/mutation trả **401** → `onUnauthorized` (`App.tsx`) xoá cache và chuyển `/login?returnUrl=…`; query không retry khi 401.
- Business logic nằm ở back-end. FE chỉ hiển thị và điều hướng; `routes/guards.ts` và menu theo vai trò **không phải** lớp bảo mật.
- IP client: Api / Realtime dùng `ForwardedHeaders`, **chỉ tin proxy ở loopback / dải IP riêng** (`HostingExtensions.TrustedProxyNetworks` — mạng Docker) → `HttpContext.Connection.RemoteIpAddress` là IP thật sau nginx (nginx VPS gửi `X-Forwarded-For`, container `web` lọc qua `realip.conf` rồi gửi đúng một giá trị). Container `web` đặt cứng `X-Forwarded-Proto: https` (không chuyển tiếp giá trị client), cả ở `/rt/`. Dev qua Vite proxy → IP là localhost.
- Cookie `officehub.auth` / `officehub.2fa`: ngoài Development luôn `Secure` (`PostConfigureAll<CookieAuthenticationOptions>` trong `AddOfficeHubDefaults`), kể cả request HTTP gọi thẳng cổng 7080. `AllowedHosts` giữ `*`: link trong email / OAuth đều lấy từ `App__BaseUrl`, không từ `Host`, còn các host gọi nhau bằng tên container (`api`, `realtime`, `mcp`).

## Host Api

`Program.cs` thứ tự: `EnvLoader.Load()` → `AddOfficeHubDefaults` → `AddOfficeHubFileStorage` → `AddOfficeHubEmail` → `AddOfficeHubAuthorization` → module `Register` → `UseOfficeHubDefaults` (ForwardedHeaders, ExceptionHandler, `/health`, `/health/ready`) → `UseAuthentication` → `UseTwoFactorEnrollmentGate` → `UseAuthorization` → `UseRateLimiter` → `/api` group → module `MapEndpoints`.

Hosted service khởi động: `IdentitySeeder` (migrate + roles + admin), `OrgMigrator`, `AttendanceSeeder` (migrate + ca mặc định).

## Route API và trang front-end

Bảng tiền tố `/api/*` → module và danh sách trang / guard: [routes.md](routes.md).

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
- **S3** (`IFileStorage`, AWSSDK.S3): key dưới `{S3__KeyPrefix}`; tải lên thẳng từ trình duyệt (presigned PUT) hoặc qua Api, đọc qua presigned GET. Thư mục theo module (tài liệu, chat, feed, finance, assets…).
- **Upload an toàn** (TEST-13, `Storage/FileTypes.cs`, `FileStorage.cs`): MIME do server suy từ **đuôi file theo danh sách cho phép** (không tin trình duyệt). Presigned PUT trỏ vào key tạm `files/uploads/<key>`; khi module xác nhận (`PromoteUploadAsync`) server **chép sang key chính**, xoá key tạm rồi kiểm cỡ + **chữ ký đầu file** trên bản đã chép (sai → xoá, 400) → link PUT còn hạn không tráo được file đã xác nhận. Presigned GET ép `Content-Type` theo đuôi; chỉ ảnh raster / PDF / video / âm thanh / chữ thuần được inline (HTML, XML, JSON phục vụ dạng `text/plain`; SVG luôn tải về). Upload qua Api (ảnh đại diện, file hợp đồng) kiểm chữ ký bằng `FileTypes.StreamMatches`. File Office người dùng tải lên (mẫu Word, Excel nhập nhân viên) qua `Documents/ZipGuard` (≤ 5.000 mục, ≤ 200 MB giải nén, tỉ lệ nén ≤ 200) + `MaxCharactersInPart`. Nên đặt **lifecycle S3 xoá `files/uploads/` sau 2 ngày** (PUT bỏ dở).
- **SMTP** (`IEmailSender`, MailKit): Identity gửi thẳng; thông báo đi qua hàng đợi trong DB (`EmailDispatcher`, [business/notifications.md](business/notifications.md)).
- **LiveKit**: voice theo khoảng cách / phòng riêng ([business/office.md](business/office.md)).
- **Log**: Serilog → console + Seq; Sentry bật khi có DSN.


## Vận hành

Trang Hệ thống → tab Vận hành (phiên bản, sao lưu, hàng đợi email, job nền `JobMonitor`): [ops.md](ops.md).
