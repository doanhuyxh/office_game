# Thông báo (module Notification)

> Nguồn sự thật là code (`backend/src/Modules/Notification/`, `backend/src/Modules/Approval/.../Infrastructure/ApprovalNotifications.cs`, `frontend/src/features/notifications/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Hai kênh (chủ dự án chốt 2026-11-05): **chuông trong app** + **email**. Module khác gửi qua `INotifier.NotifyAsync(NotificationRequest)` (project `Notification.Contracts`) với **Id tài khoản** nhận (admin không có hồ sơ nhân viên vẫn nhận được). Schema `notifications`: [database.md](../database.md).

## Gửi (`Infrastructure/Notifier.cs`)

Mỗi tài khoản nhận một dòng `notifications` (bỏ trùng, bỏ tài khoản đã khoá). Email lấy từ `IAccountService.GetManyAsync` (email + `FullName` của tài khoản):

| `EmailStatus` | Khi |
|---|---|
| `None` | `SendEmail = false` (thông báo phụ, chỉ app) hoặc tài khoản không có email |
| `Skipped` | Tên miền dành riêng (`EmailPolicy.IsDeliverable`): `.test`, `.example`, `.invalid`, `.localhost`, `.local`, `example.com/net/org` — vd tài khoản thử `@officehub.test`, admin seed `admin@example.com`. Không bao giờ gửi (tránh thư dội lại) |
| `Pending` → `Sent` / `Failed` | Còn lại: worker gửi |

## Email (`Infrastructure/EmailDispatcher.cs`)

`BackgroundService` trong host Api: mỗi **5 giây** lấy ≤ 20 dòng `Pending` có `EmailNextAttemptAt ≤ now`, gửi qua `IEmailSender` (SMTP của `.env`, timeout 15 s), lưu **từng thư**. Lỗi → thử lại sau 1 / 5 / 15 / 60 phút; tới `EmailPolicy.MaxAttempts = 5` → `Failed` (`EmailError` giữ lỗi cuối). Hàng đợi nằm trong DB → khởi động lại không mất thư. Giả định **một** instance Api (VPS đơn); chạy nhiều instance sẽ gửi trùng. Nội dung: tiêu đề, nội dung, nút "Mở OfficeHub" → `App__BaseUrl + Link` (HTML-encode mọi chuỗi).

## Sự kiện phê duyệt (`ApprovalNotifications`, gọi **sau** khi lưu đơn, không bao giờ ném lỗi)

| Khi | Ai nhận | Kênh | `Category` |
|---|---|---|---|
| Gửi đơn (`SubmitAsync`) | Người duyệt bước đầu | email + app | `approval_requested` |
| Duyệt bước trung gian | Người duyệt bước kế | email + app | `approval_requested` |
| ″ | Người gửi ("X đã duyệt", chờ bước tiếp) | chỉ app | `approval_approved` |
| Duyệt bước cuối | Người gửi (+ ghi chú nếu có) | email + app | `approval_approved` |
| Từ chối | Người gửi (+ lý do) | email + app | `approval_rejected` |
| Người gửi huỷ | Người đang phải duyệt (tính **trước** khi huỷ) | chỉ app | `approval_cancelled` |

Người duyệt: bước `Manager` → tài khoản của quản lý (`EmployeeRef.UserId`); bước `Hr` → mọi tài khoản vai trò `hr` đang hoạt động (`IAccountService.ListByRoleAsync`), **không có HR thì gửi admin**. Luôn bỏ chính người gửi. `Link` luôn là `/approvals`. Áp dụng cho mọi loại đơn (nghỉ phép, giải trình, tăng ca) — thêm loại đơn mới tự có thông báo.

## Endpoint (`/api/notifications`, đăng nhập, chỉ thấy của chính mình)

| Method | Path | Kết quả |
|---|---|---|
| GET | `/?take=20` (1–100) | Chuông: `{ unreadCount, items: [{ id, category, title, body, link, createdAt, read }] }` mới nhất trước |
| GET | `/?page=&pageSize=&unread=true` | Trang `/notifications`: `NotificationPage` = `PagedResult` + `unreadCount` (tổng chưa đọc, không theo bộ lọc); `unread=true` chỉ lấy chưa đọc |
| GET | `/unread-count` | `{ count }` |
| POST | `/{id}/read` | 204; thông báo của người khác → **404** |
| POST | `/read-all` | 204 |

## UI (`frontend/src/features/notifications/`)

- `NotificationBell` trên `Header` (cạnh nút theme): badge số chưa đọc (`data-testid="notification-unread"`), dropdown 20 mục (icon theo `category`, in đậm + chấm nếu chưa đọc, `timeAgo`), "Đánh dấu đã đọc", cuối dropdown "Xem tất cả thông báo" → `/notifications`. Bấm mục → đánh dấu đọc + `navigate(link)`.
- Trang `/notifications` (`NotificationsPage`, menu Chung → "Thông báo", mọi vai trò): tab Tất cả / Chưa đọc (số chưa đọc), "Đánh dấu tất cả đã đọc", nút ✓ đánh dấu từng mục, phân trang BE (`TablePagination`, id `notifications`), hỏi lại 30 giây.
- `useNotifications` hỏi lại mỗi **30 giây**; số chưa đọc tăng → invalidate cache `approval`, `leave`, `attendance` (badge "Phê duyệt" cập nhật theo).

Module khác: `document_retention` (hạn lưu trữ), `document_handover` (bàn giao), `project_member_added` (chỉ app) — [documents.md](documents.md); `account_security` (HR đặt lại 2FA, email + app) — [auth-2fa.md](auth-2fa.md).

**Chưa có:** tuỳ chọn tắt email theo người dùng, đẩy realtime (SignalR), gom email (digest), nhắc quên chấm ra, nhắc hợp đồng sắp hết hạn, xoá thông báo cũ.
