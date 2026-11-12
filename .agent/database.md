# Cơ sở dữ liệu

> Nguồn sự thật là code: `*DbContext.cs` + `Infrastructure/Migrations/` của từng module. Về [AGENTS.md](../AGENTS.md).

## Tổng quan

- **PostgreSQL** (server dev công ty: 18.x; container dev/prod: `postgres:17-alpine`). EF Core 10 + Npgsql 10.
- **Mỗi module một DbContext, một schema**, bảng lịch sử migration riêng `"<schema>"."__ef_migrations"` (`BuildingBlocks/Persistence/DbContextExtensions.cs` → `AddModuleDbContext<T>(config, schema)`).
- **Không JOIN / FK chéo schema.** Liên kết giữa module chỉ là cột Guid (vd `org.employees.UserId` → `identity.users.Id`, `attendance.events.EmployeeId` → `org.employees.Id`) và tra qua `*.Contracts`.
- **Tên cột PascalCase** (tên property C#), tên bảng snake_case do `ToTable(...)`. `UseSnakeCaseNamingConventionIfAvailable` hiện là no-op. SQL thô phải quote: `select "Code" from org.employees`.
- Enum lưu dạng **chuỗi** (`HasConversion<string>()`).
- Id: `Guid.CreateVersion7()` (UUID v7, sắp theo thời gian).

## Schema `identity` — `OfficeIdentityDbContext` (migration `InitialIdentity`, `AccessTokens`, `OAuth`, `UserAvatars`, `AttemptCounters`, `PasswordResetRequests`)

Bảng ASP.NET Identity đổi tên: `users`, `roles`, `user_roles`, `user_claims`, `user_logins`, `user_tokens`, `role_claims`. 2FA dùng sẵn `users.TwoFactorEnabled` + `user_tokens` (`[AspNetUserStore]` / `AuthenticatorKey`, `RecoveryCodes`) — không thêm bảng ([business/auth-2fa.md](business/auth-2fa.md)).

`access_tokens` (token AI, [business/mcp.md](business/mcp.md)): `UserId` (FK `users`, cascade, `ix_access_tokens_user`), `Name` ≤100, `TokenHash` SHA-256 hex (unique `ux_access_tokens_hash`), `Prefix` ≤20, `CreatedAt`, `ExpiresAt`, `LastUsedAt?`, `RevokedAt?` (thu hồi = đặt giá trị, không xoá dòng), `GrantId?` (FK `oauth_grants`, cascade — access token OAuth 1 giờ, xoá khi hết hạn lúc refresh).

OAuth: `oauth_clients`, `oauth_codes`, `oauth_grants` (FK `users` / client, cascade; secret chỉ lưu SHA-256) — cột + quy tắc: [business/mcp-oauth.md](business/mcp-oauth.md).

`users` (`AppUser : IdentityUser<Guid>`) thêm: `FullName` (≤200), `MustChangePassword`, `IsActive` (default true), `CreatedAt`, `LastLoginAt`, `IsBot` (default false — tài khoản bot, HR đặt; [business/office-bots.md](business/office-bots.md)).

`attempt_counters` (TEST-27): `Key` (PK, ≤300 — `s|{userId}|{ip}`, `a|{userId}`, `forgot|{email}`), `Count`, `Until` (index `ix_attempt_counters_until`). Bộ đếm cửa sổ cố định cho `LoginThrottle` + hạn mức email quên mật khẩu; tăng bằng `INSERT … ON CONFLICT DO UPDATE … RETURNING`, dòng hết hạn dọn dần (~0,5 % lần ghi).

`password_reset_requests` (TEST-28): `Id`, `UserId` (FK `users`, cascade), `CreatedAt`, `Attempts`, `NextAttemptAt` (null = xong / bỏ; index), `SentAt`, `Error` (≤500). Hàng đợi email quên mật khẩu — **không lưu token** (tạo lúc gửi). Dòng xong > 1 ngày bị xoá.
`user_avatars`: `UserId` PK (FK `users`, cascade), `Look` jsonb, `UpdatedAt` — nhân vật 3D, không dòng = mặc định ([business/office-avatar.md](business/office-avatar.md)).
- `UserName` duy nhất (`UserNameIndex`). Email **không bắt buộc**; nếu có thì duy nhất: index `ux_users_email` trên `NormalizedEmail` lọc `IS NOT NULL` (`User.RequireUniqueEmail = false`).
- `PasswordHash` null = tài khoản được mời, chưa đặt mật khẩu (`InvitePending`).
- Vai trò seed: `admin`, `hr`, `manager`, `employee`.

## Schema `org` — `OrgDbContext` (migration `InitialOrganization`)

Mọi entity kế thừa `Entity` (`Id`, `CreatedAt`, `UpdatedAt`, `DeletedAt`). `SaveChangesAsync` tự điền `CreatedAt/UpdatedAt`. **Xoá mềm** (`DeletedAt`) + `HasQueryFilter(x => x.DeletedAt == null)` cho cả 3 bảng.

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `departments` | `Name` (≤150), `Code` (≤30), `ParentId`, `HeadEmployeeId`, `MapZone` (≤50, id zone trong `shared/office-map.json`), `SortOrder`, `Description` (≤500), `Guide` (≤10000), `GuideUpdatedAt`, `GuideUpdatedByName` (migration `OrgGuides`) | `Name` unique (lọc `DeletedAt IS NULL`); FK `ParentId` → departments (Restrict). `HeadEmployeeId` **không có FK** |
| `positions` | `Name` (≤150), `Level` (cấp bậc, 1 = cao nhất; 0 = dữ liệu cũ chưa chuyển), `SortOrder`, `SelfPublishDocuments` (migration `PositionSelfPublish`), `FinancePermissions` (int bit, mặc định 0; migration `PositionFinancePermissions`), `Description` (≤500), `Guide` (≤10000), `GuideUpdatedAt`, `GuideUpdatedByName` | `Name` unique (lọc chưa xoá); index `Level` (migration `PositionLevelJobTitle`) |
| `employees` | `Code` (≤30), `FullName` (≤200), `Email` (≤256, lưu chữ thường), `Phone`, `DateOfBirth`, `DepartmentId`, `PositionId`, `JobTitle` (≤150, chức danh), địa chỉ / liên hệ khẩn cấp / `AvatarKey` / `IdNumberEncrypted` / `IdIssuedOn` / `IdIssuedPlace` / `BankName` / `BankAccountEncrypted` / `BankAccountHolder` (migration `PersonalProfile`, [business/profile.md](business/profile.md)), `ManagerId`, `Status` (`Probation`/`Active`/`Resigned`), `JoinedAt`, `LeftAt`, `UserId`, `Note` (≤2000) | `Code` unique (lọc chưa xoá); `UserId` unique (lọc NOT NULL); index `DepartmentId`, `ManagerId`, `PositionId`; FK Department/Position/Manager đều Restrict |

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

Xem [database-workflow.md](database-workflow.md) (đơn, duyệt, nghỉ phép, thông báo, hợp đồng + mẫu Word, phòng họp).

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

## Schema `projects` — `ProjectsDbContext` (migration `InitialProjects`, `ProjectContractsAndFreeze`, `AddChangeRequests`)

Bảng + index: [business/projects.md](business/projects.md#schema-projects-projectsdbcontext-migration-initialprojects). Dự án chép từ `documents.projects` (giữ Id) khi khởi động — bảng cũ giữ nguyên. `ProjectContractsAndFreeze`: bảng `contracts` (thay cột `projects.SalesContractId`, chép dữ liệu trước khi xoá cột), `allocation_freezes`, `allocations.Percent` → `numeric(5,2)` — [business/projects-finance.md](business/projects-finance.md). `AddChangeRequests`: `change_requests` (unique dự án + số) — [business/projects-changes.md](business/projects-changes.md). `TaskColumns` (2026-11-11): `task_columns`, `tasks.ColumnId` thay `State` (SQL chép dữ liệu trong migration), `projects.RequireReview` → `Sequential` — [business/projects-tasks.md](business/projects-tasks.md). Org `PositionManageTaskColumns`: `org.positions.ManageTaskColumns`. `TaskDependencies` (2026-11-11): `task_dependencies` (PK `TaskId`+`DependsOnId`, FK cascade cả hai chiều về `tasks`, index `DependsOnId`) — [business/agent-team.md](business/agent-team.md). `ProjectDepartments` (2026-11-12, TEST-40): bảng `project_departments` (PK dự án + phòng, `IsLead`, index `DepartmentId`, FK cascade về `projects`, không FK sang `org`); `projects.DepartmentId` cũ → phòng chủ trì rồi bỏ cột — [business/projects-departments.md](business/projects-departments.md). `TaskActivityKindLength` (2026-11-12, TEST-39): `task_activities.Kind` varchar 12 → 20 (thêm `CommentDeleted`). `AgentSettings` (2026-11-12, TEST-36): `agent_settings` một dòng (`Id` = 1, `MaxBotTasksPerDay`, `MaxBotStreak`, `UpdatedAt`, `UpdatedByName`; `[Audited]`; chưa có dòng = mặc định 50 / 10) — [business/agent-team.md](business/agent-team.md).

## Schema `sales` — `SalesDbContext` (migration `InitialSales`)

Bảng + index: [business/sales.md](business/sales.md#schema-sales-salesdbcontext-migration-initialsales). `collections.LedgerEntryId` trỏ sang `finance.entries` **không** FK (ranh giới module). `AddQuotes`: `quotes`, `quote_lines`, `settings` — [business/sales-quotes.md](business/sales-quotes.md). `AddContractAppendices`: `contract_appendices` (unique HĐ + số; `ChangeRequestId` unique khi chưa huỷ, không FK sang `projects`) + `installments.AppendixId` — [business/projects-changes.md](business/projects-changes.md).

## Schema `finance` — `FinanceDbContext` (migration `InitialFinance`, `AddProjectToEntries`, `AddFinanceAttachments`)

Bảng + index + seed: [business/finance.md](business/finance.md#schema-finance-financedbcontext-migration-initialfinance). Tiền `bigint` VND; dòng sổ không xoá (huỷ = `Status`). `AddProjectToEntries`: `entries.ProjectId` (index lọc khác null) + `expense_requests.ProjectId`, không FK sang schema `projects`. `AddFinanceAttachments`: `attachments` (chủ = dòng sổ / đề nghị chi, index chủ, xoá mềm) — [business/finance-docs.md](business/finance-docs.md).

## Schema `news` — `NewsDbContext` (migration `InitialNews`)

Bảng tin nội bộ: `posts` (`Seq` identity = con trỏ feed, `ContentHtml` đã lọc + `PlainText`, `Audience`, `PinnedUntil`, `HiddenAt`, xoá mềm, `ReactionCount` / `CommentCount` denormalize), `post_targets` (phạm vi: phòng ban / người), `post_media` (ảnh / video / tệp trên S3 `feed/`), `comments` (trả lời **một cấp**, ảnh tuỳ chọn, xoá mềm), `reactions` (`(TargetType, TargetId, UserId)` — mỗi người một cảm xúc), `mentions`, `feed_states` (badge bài mới), `upload_tickets`. Cột `AuthorUserId` → `identity.users.Id`, `post_targets.TargetId` → `org.departments.Id` / `identity.users.Id` (**không** FK chéo schema). Quy tắc + API: [business/news.md](business/news.md).

## Schema `audit`, `meetings`, …

Xem [database-workflow.md](database-workflow.md).
