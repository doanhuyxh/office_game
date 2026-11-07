# Phê duyệt (module Approval)

> Nguồn sự thật là code (`backend/src/Modules/Approval/`, `frontend/src/features/approvals/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Luồng duyệt **dùng chung**. Module sở hữu đơn (Leave, Attendance) gửi đơn vào đây và nhận kết quả qua handler. Schema `approval`: [database.md](../database.md).

## Gửi đơn (`IApprovalService.SubmitAsync`, project `Approval.Contracts`)

`ApprovalSubmission { Type, SubjectId, RequesterEmployeeId, Title, Summary, Steps }`. `Type` ∈ `ApprovalTypes.Leave` (`"leave"`), `ApprovalTypes.AttendanceCorrection` (`"attendance_correction"`), `ApprovalTypes.Overtime` (`"overtime"`), `ApprovalTypes.DocumentPublish` (`"document_publish"`, ban hành tài liệu — bước `[Manager]`, [documents.md](documents.md)). Mỗi (`Type`, `SubjectId`) chỉ một đơn (unique index).

Tạo bước (`Infrastructure/ApprovalService.cs`):

| `ApprovalStepKind` | Người duyệt | Khi nào bỏ qua |
|---|---|---|
| `Manager` | `ManagerId` của người gửi (lưu `ApproverEmployeeId`) | Không có quản lý, hoặc quản lý đã nghỉ việc |
| `Hr` | Bất kỳ ai có vai trò `hr` / `admin` | — |

Nếu mọi bước bị bỏ qua thì luôn còn 1 bước `Hr`. Bước đầu `Pending`, các bước sau `Waiting`. Leave, giải trình và tăng ca đều gửi `[Manager, Hr]`.

## Ai được quyết định (`CanDecide`)

| Điều kiện | Kết quả |
|---|---|
| Đơn không còn `Pending` | Không ai |
| Người thao tác chính là người gửi | **Không** (không tự duyệt), kể cả HR / admin |
| Bước hiện tại `Manager` | Đúng nhân viên `ApproverEmployeeId`, **người được người đó uỷ quyền hôm nay** ("duyệt thay", [approval-delegation.md](approval-delegation.md)), hoặc **admin** |
| Bước hiện tại `Hr` | Vai trò `hr` / `admin` (HR **không** duyệt thay bước quản lý; uỷ quyền không áp dụng) |

Hàm thuần `Domain/ApprovalRules.cs` (`Right` → `Approver` / `Delegate` / `Admin` / `Hr` / `None`; test `tests/OfficeHub.Modules.Approval.Tests`).

## Endpoint (`Features/ApprovalEndpoints.cs`, `/api/approval`, cần đăng nhập)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/inbox`, `/inbox/count` | Đơn tôi được quyết định ngay bây giờ |
| GET | `/mine` | Đơn tôi gửi (200 dòng mới nhất) |
| GET | `/{id}` | Người gửi, HR, người duyệt của một bước, người đã quyết định một bước, người đang được uỷ quyền của người duyệt; khác → 403 `"Bạn không có quyền xem đơn này"` |
| POST | `/{id}/approve` | `{ comment? }` |
| POST | `/{id}/reject` | `{ comment }`; trống → 400 `"Nhập lý do từ chối"` |
| POST | `/{id}/cancel` | Chỉ người gửi, khi `Pending`. Khác → 403 `"Chỉ người gửi được huỷ đơn"` / 409 `"Chỉ huỷ được đơn đang chờ duyệt"` |

Lỗi chung: đã xử lý → 409 `"Đơn đã được xử lý"`; không đúng người → 403 `"Bạn không phải người duyệt bước hiện tại của đơn này"`.

DTO trả `canDecide`, `canCancel`, `decideOnBehalfOfName` (có = người gọi chỉ duyệt được với tư cách người được uỷ quyền) tính theo người gọi; bước có `onBehalfOfName` khi đã duyệt thay — FE chỉ dựa vào các cờ này. Uỷ quyền: `/api/approval/delegations` ([approval-delegation.md](approval-delegation.md)).

## Quyết định (`DecideAsync`) — giữ nguyên thứ tự

1. Cập nhật bước hiện tại (`Approved` / `Rejected`, `DecidedByUserId`, `DecidedByName` = claim `full_name`, `Comment`; duyệt thay → `OnBehalfOfEmployeeId` / `OnBehalfOfName` = người quản lý được thay).
2. Từ chối → `handler.OnRejectedAsync(subjectId, comment)` → đơn `Rejected`.
3. Duyệt còn bước `Waiting` → bước kế tiếp thành `Pending` (chưa gọi handler).
4. Duyệt bước cuối → `handler.OnApprovedAsync(subjectId)` → đơn `Approved`.
5. `SaveChangesAsync`.

Handler chạy **trước** khi lưu đơn duyệt. Nếu handler ném lỗi, đơn vẫn ở bước cũ và có thể duyệt lại. Vì vậy **mọi `IApprovalHandler` phải idempotent** (chỉ đổi khi bản ghi gốc còn `Pending`; sự kiện chấm công dùng `IdempotencyKey`). Huỷ: `handler.OnCancelledAsync` → đơn `Cancelled`.

Thêm loại đơn mới: hằng số trong `ApprovalTypes` + class `IApprovalHandler` ở module sở hữu, đăng ký `services.AddScoped<IApprovalHandler, …>()`. Thiếu handler → `InvalidOperationException` khi quyết định.

**Thông báo:** sau khi lưu, `ApprovalNotifications` báo người duyệt (gửi đơn / chuyển bước) và người gửi (duyệt / từ chối), báo người duyệt khi đơn bị huỷ — chi tiết [notifications.md](notifications.md). Không bao giờ làm hỏng thao tác duyệt.

**Chưa có:** sửa đơn đã gửi (huỷ rồi gửi lại).

## UI (`frontend/src/features/approvals/`)

- `ApprovalsPage`: tab "Chờ tôi duyệt (n)" / "Đơn của tôi" / "Uỷ quyền" (`DelegationsTab`); nút "Uỷ quyền duyệt" (`PageToolbar`, người có cấp dưới hoặc HR) mở `DelegationDialog`. Tab mặc định chọn **sau khi** inbox tải xong (có đơn → inbox).
- `ApprovalCard`: loại, người gửi, tóm tắt, các bước (`○` chờ tới lượt, `⏳` đang chờ, `✓`, `✕` + người quyết định (+ ", duyệt thay X") + ghi chú), nút Duyệt (duyệt thay → "Duyệt thay" + dòng "Bạn duyệt thay X") / Từ chối (dialog bắt buộc lý do) / Huỷ đơn.
- Badge số đơn trên menu "Phê duyệt" (`AppSidebar`, `useInboxCount` refetch 60s). Menu hiện cho mọi người.
- Mutation duyệt / từ chối / huỷ invalidate `['approval']`, `['leave']`, `['attendance']`.
