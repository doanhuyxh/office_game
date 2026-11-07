# Cơ sở dữ liệu — đơn, duyệt, nghỉ phép, thông báo, hợp đồng, phòng họp

> Phần chung (quy ước, seed, viết migration): [database.md](database.md). Nguồn sự thật là code: `*DbContext.cs` + `Infrastructure/Migrations/`. Về [AGENTS.md](../AGENTS.md).

## Schema `approval` — `ApprovalDbContext` (migration `InitialApproval`, `ApprovalDelegation`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `requests` | `Type`, `SubjectId`, `RequesterEmployeeId`, `Title`, `Summary`, `Status`, `CreatedAt`, `DecidedAt` | unique (`Type`,`SubjectId`); index (`RequesterEmployeeId`,`Status`) |
| `steps` | `RequestId`, `Order`, `Kind` (`Manager`/`Hr`), `ApproverEmployeeId`, `Status` (`Waiting`/`Pending`/`Approved`/`Rejected`), `DecidedByUserId`, `DecidedByName`, `Comment`, `OnBehalfOfEmployeeId?`/`OnBehalfOfName?` (duyệt thay) | FK cascade; unique (`RequestId`,`Order`) |
| `delegations` | `DelegatorEmployeeId`, `DelegateEmployeeId`, `FromDate`/`ToDate` (date, cả hai đầu), `Note` ≤500, `CreatedAt/ByUserId/ByName`, `RevokedAt/ByUserId/ByName` (thu hồi, không xoá) | index (`DelegatorEmployeeId`,`ToDate`), (`DelegateEmployeeId`,`ToDate`); chống trùng bằng code + advisory lock ([business/approval-delegation.md](business/approval-delegation.md)) |

## Schema `leave` — `LeaveDbContext` (migration `InitialLeave`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `types` | `Code` (unique), `Name`, `IsPaid`, `UsesAnnualBalance`, `SortOrder`, `IsActive` | seed 4 loại |
| `requests` | `EmployeeId`, `LeaveTypeId`, `StartDate`, `EndDate`, `Period`, `Days` numeric(6,2), `Reason`, `Status`, `ApprovalRequestId`, `RejectReason` | FK type (Restrict); chống trùng ngày bằng code (không EXCLUDE) |
| `adjustments` | `EmployeeId`, `Days` (±), `Reason`, `CreatedAt`, `CreatedByName` | chỉ thêm |

Quỹ phép **không lưu**: tính khi đọc ([business/leave.md](business/leave.md)).

## Schema `notifications` — `NotificationDbContext` (migration `InitialNotification`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `notifications` | `UserId` (tài khoản nhận, `identity.users.Id`), `Category` (≤50), `Title` (≤300), `Body` (≤2000), `Link` (≤300), `CreatedAt`, `ReadAt`; hàng đợi email: `EmailTo`, `EmailToName`, `EmailStatus` (`None`/`Pending`/`Sent`/`Failed`/`Skipped`), `EmailAttempts`, `EmailNextAttemptAt`, `EmailSentAt`, `EmailError` (≤1000) | index (`UserId`,`CreatedAt`); index `EmailNextAttemptAt` lọc `"EmailStatus" = 'Pending'` |

Một dòng cho mỗi người nhận. Chỉ module Notification ghi; `EmailDispatcher` cập nhật cột `Email*`. Chưa có job xoá thông báo cũ ([business/notifications.md](business/notifications.md)).

## Schema `contracts` — `ContractsDbContext` (migration `InitialContracts`, `ContractTemplates`, `SignRequests`, `ProbationReminders`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `contracts` | `EmployeeId`, `Number` (≤50), `Type` (`Indefinite`/`Fixed`/`Probation`), `SignedDate`, `StartDate`, `EndDate` (null = vô thời hạn), `JobTitle`, `SalaryEncrypted` / `AllowanceEncrypted` (≤200, `v1:…` AES-GCM), `Note`, `TerminatedOn`, `TerminationReason`, `FileKey`/`FileName`/`FileContentType`/`FileSize` (owned `StoredFile`), `Reminded30At`, `Reminded7At`, `Reminded3At`, `OverdueRemindedAt` (nhắc thử việc, [business/contracts-reminders.md](business/contracts-reminders.md)), `CreatedAt`, `UpdatedAt`, `DeletedAt` | `Number` unique lọc `DeletedAt IS NULL`; index (`EmployeeId`,`StartDate`); index `EndDate` lọc chưa xoá + chưa chấm dứt; query filter xoá mềm |
| `amendments` | `ContractId`, `Number`, `EffectiveDate`, `Content` (≤2000), `SalaryEncrypted`, `AllowanceEncrypted`, `File*` | FK cascade; index (`ContractId`,`EffectiveDate`) |

`templates` (mẫu Word): `Name` ≤200, `ContractType?` (string), `Fields text[]`, file owned `StoredFile` (S3 `contract-templates/{id}.docx`), `CreatedAt`, `CreatedByName`; xoá cứng + xoá file S3.

`sign_requests` [Audited] (ký điện tử, [business/contracts-esign.md](business/contracts-esign.md)): `ContractId`, `EmployeeId`, `SignerUserId`, `OriginalFileKey` + `OriginalSha256`, `Status` (string ≤10), `ExpiresAt`, `OtpHash` (SHA-256, không lưu OTP), `OtpSentAt/ExpiresAt/Attempts/Sends`, `SignedAt`, `SignerIp`, `SignerUserAgent` ≤512, `SignedFileKey` + `SignedSha256`, `SignatureImageKey`; index `ContractId`, (`SignerUserId`,`Status`).

Trạng thái hợp đồng tính lúc đọc. Không trùng thời gian / số phụ lục kiểm tra bằng code ([business/contracts.md](business/contracts.md)). Cột `…Encrypted` cần `Encryption__Key` cũ để đọc.

## Schema `meetings` — `MeetingsDbContext` (migration `InitialMeetings`)

| Bảng | Cột chính | Ràng buộc |
|---|---|---|
| `bookings` | `RoomId` (≤50, id phòng trong `shared/office-map.json`), `Title` ≤200, `StartAt` / `EndAt` (timestamptz UTC), `OrganizerEmployeeId`, `OrganizerUserId`, `OrganizerName`, `Note` ≤1000, `CreatedAt`, `CancelledAt?` | index (`RoomId`, `StartAt`); không trùng giờ kiểm tra bằng code + `pg_advisory_xact_lock` theo phòng ([business/meetings.md](business/meetings.md)) |
| `attendees` | PK (`BookingId`, `EmployeeId`), `UserId?`, `Name` | FK `bookings` cascade; index `EmployeeId` |

Reporting **không có schema** (chỉ đọc qua `*.Contracts`).

## Schema `audit` — `AuditDbContext` (migration `InitialAudit`, `ChangeLog`)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `ai_requests` | request bằng token AI | index (`UserId`,`OccurredAt`), `OccurredAt`; tự xoá > 180 ngày ([business/mcp-oauth.md](business/mcp-oauth.md)) |
| `changes` | `OccurredAt`, `Source` (web/ai/system), `UserId?`, `UserName`, `Module` (schema), `Entity`, `EntityId`, `EntityLabel`, `Action`, `ChangesJson` (jsonb `[{field, old, new, masked}]`) | index `OccurredAt`, (`Entity`,`EntityId`,`OccurredAt`), (`UserId`,`OccurredAt`); không tự xoá ([business/audit.md](business/audit.md)) |

`attendance.reminders` (migration `Reminders`): `EmployeeId`, `WorkDate`, `Kind` (Checkout / MissingCheckout), `SentAt`; unique (`EmployeeId`,`WorkDate`,`Kind`) — chống nhắc lặp.

## Schema `documents` — `DocumentsDbContext` (migration `InitialDocuments`)

Chi tiết: [business/documents.md](business/documents.md). Enum lưu chuỗi; JSON trả chuỗi (`JsonStringEnumConverter` gắn trên enum của module). `projects` [Audited] (`Code` ≤30 unique lọc chưa xoá, `Name` ≤200, `Status` Active/Closed, `DepartmentId?`, xoá mềm `DeletedAt` + query filter). `project_members` (PK `ProjectId`+`EmployeeId`, `Role` Member/Manager, cascade). `folders` (`SpaceKind`, `SpaceId?` — null = kho công ty, `ParentId` FK Restrict, `Name` ≤200; unique (`SpaceKind`,`SpaceId`,`ParentId`,`Name`) **NULLS NOT DISTINCT**). `doc_types` [Audited] (`Code` ≤10 unique, `RetentionYears?`, `IsActive`; `DocumentsMigrator` seed 10 loại khi trống). `assets` [Audited] (`Code` unique, `Title` ≤300, `Tags` text[], `SpaceKind`/`SpaceId`/`FolderId` (FK Restrict), `DocTypeId` (FK Restrict), `Kind`, `Classification`, `Status`, `CurrentVersion`, `TotalSize`, `Custodian*`, `CreatedBy*`, `DocumentNumber`, `PublishedAt`, `ApprovalRequestId`, `SubmittedByEmployeeId` (migration `AssetSubmittedBy`), `RetentionUntil` date, `RetentionNotifiedAt`, `Destroyed*`, `DeletedAt` = thùng rác). `asset_versions` (unique `AssetId`+`Number`, `FileKey?` — null khi đã huỷ, cascade). `access_logs` (chỉ thêm; index `AssetId`+`At`). `upload_tickets` (vé tải lên, xoá khi dùng / quá 24 giờ). `sequences` (PK `Scope`: `asset:{năm}`, `pub:{loại}:{kho}:{năm}`; tăng bằng `INSERT … ON CONFLICT … RETURNING`).

## Schema `chat` — `ChatDbContext` (migration `InitialChat`)

Bảng `conversations`, `room_members`, `messages` (`Seq` identity), `attachments`, `read_states`, `upload_tickets`: [business/chat.md](business/chat.md#schema-chat). Enum `ConversationType` trả chuỗi (`JsonStringEnumConverter`).

## Schema `payroll` — `PayrollDbContext` (migration `InitialPayroll`)

Bảng `settings`, `profiles`, `periods`, `payslips` (phiếu mã hoá), `adjustments`: [business/payroll.md](business/payroll.md#schema-payroll).
