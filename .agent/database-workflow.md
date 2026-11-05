# Cơ sở dữ liệu — đơn, duyệt, nghỉ phép, thông báo, hợp đồng

> Phần chung (quy ước, seed, viết migration): [database.md](database.md). Nguồn sự thật là code: `*DbContext.cs` + `Infrastructure/Migrations/`. Về [AGENTS.md](../AGENTS.md).

## Schema `approval` — `ApprovalDbContext` (migration `InitialApproval`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `requests` | `Type`, `SubjectId`, `RequesterEmployeeId`, `Title`, `Summary`, `Status`, `CreatedAt`, `DecidedAt` | unique (`Type`,`SubjectId`); index (`RequesterEmployeeId`,`Status`) |
| `steps` | `RequestId`, `Order`, `Kind` (`Manager`/`Hr`), `ApproverEmployeeId`, `Status` (`Waiting`/`Pending`/`Approved`/`Rejected`), `DecidedByUserId`, `DecidedByName`, `Comment` | FK cascade; unique (`RequestId`,`Order`) |

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

## Schema `contracts` — `ContractsDbContext` (migration `InitialContracts`)

| Bảng | Field chính | Ràng buộc / index |
|---|---|---|
| `contracts` | `EmployeeId`, `Number` (≤50), `Type` (`Indefinite`/`Fixed`/`Probation`), `SignedDate`, `StartDate`, `EndDate` (null = vô thời hạn), `JobTitle`, `SalaryEncrypted` / `AllowanceEncrypted` (≤200, `v1:…` AES-GCM), `Note`, `TerminatedOn`, `TerminationReason`, `FileKey`/`FileName`/`FileContentType`/`FileSize` (owned `StoredFile`), `Reminded30At`, `Reminded7At`, `CreatedAt`, `UpdatedAt`, `DeletedAt` | `Number` unique lọc `DeletedAt IS NULL`; index (`EmployeeId`,`StartDate`); index `EndDate` lọc chưa xoá + chưa chấm dứt; query filter xoá mềm |
| `amendments` | `ContractId`, `Number`, `EffectiveDate`, `Content` (≤2000), `SalaryEncrypted`, `AllowanceEncrypted`, `File*` | FK cascade; index (`ContractId`,`EffectiveDate`) |

Trạng thái hợp đồng tính lúc đọc. Không trùng thời gian / số phụ lục kiểm tra bằng code ([business/contracts.md](business/contracts.md)). Cột `…Encrypted` cần `Encryption__Key` cũ để đọc.
