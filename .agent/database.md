# Cơ sở dữ liệu

> Nguồn sự thật là code: `*DbContext.cs` + `Infrastructure/Migrations/` của từng module. Về [AGENTS.md](../AGENTS.md).

## Tổng quan

- **PostgreSQL** (server dev công ty: 18.x; container dev/prod: `postgres:17-alpine`). EF Core 10 + Npgsql 10.
- **Mỗi module một DbContext, một schema**, bảng lịch sử migration riêng `"<schema>"."__ef_migrations"` (`BuildingBlocks/Persistence/DbContextExtensions.cs` → `AddModuleDbContext<T>(config, schema)`).
- **Không JOIN / FK chéo schema.** Liên kết giữa module chỉ là cột Guid (vd `org.employees.UserId` → `identity.users.Id`, `attendance.events.EmployeeId` → `org.employees.Id`) và tra qua `*.Contracts`.
- **Tên cột PascalCase** (tên property C#), tên bảng snake_case do `ToTable(...)`. `UseSnakeCaseNamingConventionIfAvailable` hiện là no-op. SQL thô phải quote: `select "Code" from org.employees`.
- Enum lưu dạng **chuỗi** (`HasConversion<string>()`).
- Id: `Guid.CreateVersion7()` (UUID v7, sắp theo thời gian).

## Schema `identity` — `OfficeIdentityDbContext` (migration `InitialIdentity`, `AccessTokens`, `OAuth`)

Bảng ASP.NET Identity đổi tên: `users`, `roles`, `user_roles`, `user_claims`, `user_logins`, `user_tokens`, `role_claims`.

`access_tokens` (token AI, [business/mcp.md](business/mcp.md)): `UserId` (FK `users`, cascade, `ix_access_tokens_user`), `Name` ≤100, `TokenHash` SHA-256 hex (unique `ux_access_tokens_hash`), `Prefix` ≤20, `CreatedAt`, `ExpiresAt`, `LastUsedAt?`, `RevokedAt?` (thu hồi = đặt giá trị, không xoá dòng), `GrantId?` (FK `oauth_grants`, cascade — access token OAuth 1 giờ, xoá khi hết hạn lúc refresh).

OAuth: `oauth_clients`, `oauth_codes`, `oauth_grants` (FK `users` / client, cascade; secret chỉ lưu SHA-256) — cột + quy tắc: [business/mcp-oauth.md](business/mcp-oauth.md).

`users` (`AppUser : IdentityUser<Guid>`) thêm: `FullName` (≤200), `MustChangePassword`, `IsActive` (default true), `CreatedAt`, `LastLoginAt`.
- `UserName` duy nhất (`UserNameIndex`). Email **không bắt buộc**; nếu có thì duy nhất: index `ux_users_email` trên `NormalizedEmail` lọc `IS NOT NULL` (`User.RequireUniqueEmail = false`).
- `PasswordHash` null = tài khoản được mời, chưa đặt mật khẩu (`InvitePending`).
- Vai trò seed: `admin`, `hr`, `manager`, `employee`.

## Schema `org` — `OrgDbContext` (migration `InitialOrganization`)

Mọi entity kế thừa `Entity` (`Id`, `CreatedAt`, `UpdatedAt`, `DeletedAt`). `SaveChangesAsync` tự điền `CreatedAt/UpdatedAt`. **Xoá mềm** (`DeletedAt`) + `HasQueryFilter(x => x.DeletedAt == null)` cho cả 3 bảng.

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `departments` | `Name` (≤150), `Code` (≤30), `ParentId`, `HeadEmployeeId`, `MapZone` (≤50, id zone trong `shared/office-map.json`), `SortOrder` | `Name` unique (lọc `DeletedAt IS NULL`); FK `ParentId` → departments (Restrict). `HeadEmployeeId` **không có FK** |
| `positions` | `Name` (≤150), `SortOrder` | `Name` unique (lọc chưa xoá) |
| `employees` | `Code` (≤30), `FullName` (≤200), `Email` (≤256, lưu chữ thường), `Phone`, `DateOfBirth`, `DepartmentId`, `PositionId`, `ManagerId`, `Status` (`Probation`/`Active`/`Resigned`), `JoinedAt`, `LeftAt`, `UserId`, `Note` (≤2000) | `Code` unique (lọc chưa xoá); `UserId` unique (lọc NOT NULL); index `DepartmentId`, `ManagerId`, `PositionId`; FK Department/Position/Manager đều Restrict |

- Nghỉ việc **không xoá** nhân viên: `Status = Resigned` + `LeftAt`. Chưa có API xoá nhân viên.
- `NextCodeAsync` đọc cả bản ghi đã xoá mềm (`IgnoreQueryFilters`) để không tái dùng mã `NV###`.

## Schema `attendance` — `AttendanceDbContext` (migration `InitialAttendance`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `shifts` | `Name` (≤100), `Type` (`Fixed`/`Flexible`), `StartTime`, `EndTime`, `GraceMinutes`, `RequiredMinutes`, `EarliestIn`, `LatestIn`, `BreakStart`, `BreakEnd` (TimeOnly), `CreatedAt`, `DeletedAt` | xoá mềm + query filter |
| `schedules` | `EmployeeId` (null = lịch công ty), `EffectiveFrom`, `DayOfWeek`, `ShiftId` (null = nghỉ), `CreatedAt` | unique (`EmployeeId`,`EffectiveFrom`,`DayOfWeek`) với **NULLS NOT DISTINCT**; FK `ShiftId` → shifts (Restrict) |
| `events` | `EmployeeId`, `OccurredAt` (UTC), `WorkDate` (ngày theo giờ VP), `Type` (`In`/`Out`), `Source` (`Web`/`Office3D`/`Device`/`Manual`), `WorkMode` (`Onsite`/`Remote`), `Ip` (≤64), `UserAgent` (≤512), `Note`, `IdempotencyKey` (≤100) | index (`EmployeeId`,`WorkDate`), index `WorkDate`, `IdempotencyKey` unique (lọc NOT NULL) |
| `holidays` | `Date`, `Name` (≤150) | `Date` unique |

Quy tắc ghi:
- `events` **chỉ thêm, không sửa / xoá** (sự kiện thô). Không có bảng bảng công — bảng công tính lại khi đọc ([business/attendance.md](business/attendance.md)).
- `schedules`: đổi lịch = thêm bộ 7 dòng với `EffectiveFrom` mới; lưu lại cùng `EffectiveFrom` thì `ExecuteDeleteAsync` bộ cũ rồi thêm. Không sửa bộ có hiệu lực trước đó.
- `shifts` xoá mềm (bảng công cũ vẫn tra được tên ca: `AttendanceService` dùng `IgnoreQueryFilters()`).
- `holidays` xoá cứng.

| `corrections` | `EmployeeId`, `WorkDate`, `Type` (`In`/`Out`), `Time`, `WorkMode`, `Reason` (≤500), `Status` (`Pending`/`Approved`/`Rejected`/`Cancelled`), `ApprovalRequestId`, `RejectReason` | index (`EmployeeId`,`WorkDate`). Duyệt xong sinh sự kiện `IdempotencyKey = "correction:{Id}"` |
| `overtime_requests` (migration `AddOvertime`) | `EmployeeId`, `WorkDate`, `StartTime`, `EndTime` (TimeOnly, cùng ngày), `Minutes`, `Reason` (≤500), `Status` (`Pending`/`Approved`/`Rejected`/`Cancelled`), `ApprovalRequestId`, `RejectReason` (≤1000), `CreatedAt`, `DecidedAt` | index (`EmployeeId`,`WorkDate`). Không lưu loại ngày (tính lúc đọc). Chống trùng giờ bằng code |

## Schema `approval`, `leave`, `notifications`

Xem [database-workflow.md](database-workflow.md) (đơn, duyệt, nghỉ phép, thông báo).

## Dữ liệu seed khi khởi động

| Seeder | Điều kiện | Tạo |
|---|---|---|
| `IdentitySeeder` | luôn | 4 vai trò; admin từ `Seed__*` nếu chưa có user vai trò admin (vai trò `admin` + `hr`) |
| `AttendanceSeeder` | bảng `shifts` trống (kể cả bản xoá mềm) | ca "Hành chính" 08:30–17:30 (nghỉ 12:00–13:30, trễ 5′), ca "Linh hoạt 8 tiếng" (480′, vào 07:00–10:00, nghỉ 12:00–13:00), lịch công ty `EffectiveFrom = 2000-01-01`: T2–T6 = Hành chính, T7/CN nghỉ |
| `OrgMigrator`, `ApprovalMigrator`, `NotificationMigrator` | — | chỉ migrate |
| `LeaveSeeder` | `leave.types` trống | 4 loại phép |

Mọi seeder/migrator chỉ chạy migration khi `Database__MigrateOnStartup` khác `false`.

## Viết migration

1. Sửa entity / `OnModelCreating` trong DbContext của module.
2. Từ `backend/`: lệnh `dotnet ef migrations add …` ([commands.md](commands.md#migration-ef-core)). `DesignTimeFactory` trong mỗi DbContext dùng chuỗi kết nối giả → không cần DB khi tạo migration.
3. Module **mới** cần DB: tạo `<M>DbContext` (`HasDefaultSchema`), `DesignTimeFactory`, gọi `services.AddModuleDbContext<…>(config, Schema)` và một hosted service gọi `Database.MigrateAsync()` (mẫu `OrgMigrator`).
4. Lần chạy đầu trên schema mới, EF log `ERR Failed executing DbCommand … __ef_migrations` trước khi tạo bảng — bình thường.

## Không có

Không transaction trải nhiều module (mỗi request gọi `SaveChangesAsync` riêng từng DbContext). Ví dụ cấp tài khoản: Identity tạo user → Organization ghi `UserId`; nếu bước 2 lỗi sẽ còn user mồ côi (cần xác nhận cách xử lý nếu xảy ra). Không audit log. Hàng đợi email thông báo nằm trong bảng `notifications.notifications` (cột `Email*`), không có outbox sự kiện giữa module.

## Schema `audit` — `AuditDbContext` (migration `InitialAudit`)

`ai_requests`: mọi request bằng token AI; index `(UserId, OccurredAt)`, `OccurredAt`. Chỉ thêm, tự xoá > 180 ngày — chi tiết [business/mcp-oauth.md](business/mcp-oauth.md#nhật-ký-ai-module-audit-schema-audit).
