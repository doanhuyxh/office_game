# Thông báo (module Notification)

> Nguồn sự thật là code (`backend/src/Modules/Notification/`, `backend/src/Modules/Approval/.../Infrastructure/ApprovalNotifications.cs`, `frontend/src/features/notifications/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Ba kênh: **chuông trong app** + **email** (chốt 2026-11-05) + **push FCM** (chốt 2026-11-08, Firebase Cloud Messaging). Module khác gửi qua `INotifier.NotifyAsync(NotificationRequest)` (project `Notification.Contracts`) với **Id tài khoản** nhận (admin không có hồ sơ nhân viên vẫn nhận được). Schema `notifications`: [database.md](../database.md).

## Push (FCM)

`IPushSender.PushAsync` (project `Notification.Contracts`) — best-effort, không ghi bảng `notifications`, không bao giờ ném lỗi; tắt hoàn toàn nếu thiếu `Firebase__CredentialsPath` ([env.md](../env.md)). `Notifier.NotifyAsync` tự gọi sau khi lưu chuông/email, nên **mọi** category hiện có (phê duyệt, nghỉ phép, tài sản, hợp đồng, 2FA, Bảng tin…) tự có push — không cần sửa module gọi `INotifier`. Chat gọi `IPushSender` trực tiếp (không qua `INotifier`, vì chủ động không tạo chuông/email — [chat.md](chat.md)).

Bảng `push_tokens` (migration `AddPushTokens`): `UserId`, `Token` (duy nhất), `CreatedAt`, `LastSeenAt`. Đăng ký / huỷ: `PUT` / `DELETE /api/notifications/push-tokens` `{ token }` (DELETE chỉ xoá token của chính tài khoản; PUT chuyển chủ token — đăng nhập tài khoản khác trên cùng máy). Gửi theo lô ≤ 500 token/lần (`SendEachForMulticastAsync`); token bị FCM báo không tồn tại (`Unregistered` / `InvalidArgument`) → xoá luôn khỏi `push_tokens`.

FE: `frontend/src/lib/firebase.ts` (`initializeApp` + `getMessaging`, cấu hình `VITE_FIREBASE_*`), service worker gộp vào `public/sw.js` (lắng `push` + `notificationclick`, không cần Firebase SDK trong SW). Công tắc "Bật thông báo đẩy" ở `/profile` + dropdown chuông gọi `Notification.requestPermission()` → `getToken()` → đăng ký token. Tab đang mở: `onMessage()` chỉ phát âm + toast (không gọi `showNotification`, tránh trùng UI). Có push đăng ký thành công → giảm chu kỳ poll chuông (xem mục UI dưới).

**Không push**: kênh Chat `Office` (toàn công ty, quá ồn); Bảng tin loại bài mới không chọn gửi email (giữ nguyên quy tắc chống spam đã chốt).

## Gửi (`Infrastructure/Notifier.cs`)

Mỗi tài khoản nhận một dòng `notifications` (bỏ trùng, bỏ tài khoản đã khoá). Email lấy từ `IAccountService.GetManyAsync` (email + `FullName` của tài khoản):

| `EmailStatus` | Khi |
|---|---|
| `None` | `SendEmail = false` (thông báo phụ, chỉ app), tài khoản không có email, hoặc người nhận **đã tắt email** (`EmailPolicy.ShouldEmail`; riêng `account_security` vẫn gửi) |
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
| Tạo / thu hồi uỷ quyền duyệt | Người được uỷ quyền (email + app); người uỷ quyền khi HR làm thay (chỉ app) | | `approval_delegation` |

Người duyệt: bước `Manager` → tài khoản của quản lý (`EmployeeRef.UserId`) **+ người được quản lý đó uỷ quyền hôm nay** ([approval-delegation.md](approval-delegation.md)); duyệt thay → tên người quyết định ghi `"X (duyệt thay Y)"`; bước `Hr` → mọi tài khoản vai trò `hr` đang hoạt động (`IAccountService.ListByRoleAsync`), **không có HR thì gửi admin**. Luôn bỏ chính người gửi. `Link` luôn là `/approvals`. Áp dụng cho mọi loại đơn (nghỉ phép, giải trình, tăng ca) — thêm loại đơn mới tự có thông báo.

## Endpoint (`/api/notifications`, đăng nhập, chỉ thấy của chính mình)

| Method | Path | Kết quả |
|---|---|---|
| GET | `/?take=20` (1–100) | Chuông: `{ unreadCount, items: [{ id, category, title, body, link, createdAt, read }] }` mới nhất trước |
| GET | `/?page=&pageSize=&unread=true` | Trang `/notifications`: `NotificationPage` = `PagedResult` + `unreadCount` (tổng chưa đọc, không theo bộ lọc); `unread=true` chỉ lấy chưa đọc |
| GET | `/unread-count` | `{ count }` |
| POST | `/{id}/read` | 204; thông báo của người khác → **404** |
| POST | `/read-all` | 204 |
| GET / PUT | `/preferences` | `{ emailEnabled }` — tuỳ chọn email của chính mình (bảng `preferences`, chưa có dòng = bật). Chỉ áp cho thông báo tạo sau đó |

## UI (`frontend/src/features/notifications/`)

- `NotificationBell` trên `Header` (cạnh nút theme): badge số chưa đọc (`data-testid="notification-unread"`), dropdown 20 mục (icon theo `category`, in đậm + chấm nếu chưa đọc, `timeAgo`), "Đánh dấu đã đọc", cuối dropdown "Xem tất cả thông báo" → `/notifications`. Bấm mục → đánh dấu đọc + `navigate(link)`.
- Trang `/notifications` (`NotificationsPage`, menu Chung → "Thông báo", mọi vai trò): tab Tất cả / Chưa đọc (số chưa đọc), "Đánh dấu tất cả đã đọc", nút ✓ đánh dấu từng mục, phân trang BE (`TablePagination`, id `notifications`), hỏi lại 30 giây.
- `useNotifications` hỏi lại mỗi **30 giây** (fallback), hoặc **2 phút** nếu đã đăng ký push FCM thành công (push là kênh báo nhanh chính lúc đó); số chưa đọc tăng → phát âm chuông (nếu bật) + invalidate cache `approval`, `leave`, `attendance` (badge "Phê duyệt" cập nhật theo).
- **Âm thanh** (chỉ phía trình duyệt, `utils/sound.ts` + `useNotificationSound`): số chưa đọc tăng → phát `public/sounds/notification.mp3`. Bật/tắt lưu ở `localStorage` (`officehub.notification-sound`, **mặc định bật**), chỉnh ở nút loa trong dropdown chuông **và** thẻ "Tùy chọn thông báo" ở `/profile` (dùng chung giá trị, đồng bộ giữa các tab). Trình duyệt chặn phát khi trang chưa được tương tác → nuốt lỗi; không phát khi vừa tải (chỉ khi số tăng trong phiên).
- **Email** (ô thứ 3 trong thẻ "Tùy chọn thông báo" ở `/profile`): lưu ở server theo tài khoản (`GET/PUT /api/notifications/preferences`); tắt → chuông + push vẫn có. Email đăng nhập / link mời / OTP ký hợp đồng gửi thẳng, không qua tuỳ chọn này.
- **Thông báo đẩy** (công tắc cạnh âm thanh, cùng 2 chỗ): `Notification.requestPermission()` → `getToken()` → `PUT /push-tokens`; tắt → `DELETE /push-tokens`. Lưu `officehub.push-enabled` ở `localStorage`.

Module khác: `document_retention` (hạn lưu trữ), `document_handover` (bàn giao), `project_member_added` (chỉ app) — [documents.md](documents.md); `contract_expiring` (hợp đồng 30 / 7 ngày), `probation_ending` (thử việc 7 / 3 ngày + quá hạn, chưa có HĐ tiếp theo) — [contracts-reminders.md](contracts-reminders.md); `asset_assigned` / `asset_returned` / `asset_expiring` / `asset_offboarding` / `asset_review` (tài sản công ty) — [assets.md](assets.md); `social_post` (đăng bài MXH lỗi → người đăng, chỉ app · token BM bị Facebook từ chối → HR + người giữ, email) — [assets-social.md](assets-social.md); `account_security` (HR đặt lại 2FA, email + app) — [auth-2fa.md](auth-2fa.md); `expense_ready` (đề nghị chi đã duyệt → người có quyền Ghi sổ) / `expense_paid` (đã chi → người gửi), chỉ app — [finance.md](finance.md); `receivable_due` (đợt thu sắp / đến / quá hạn) / `customer_follow_up` (việc chăm sóc đến hẹn) — [sales.md](sales.md); `project_task` (giao việc, bình luận, việc đến hạn / quá hạn; việc mới / đổi trạng thái / bình luận → mọi thành viên dự án trừ người thao tác — [projects-tasks.md](projects-tasks.md)) + `project_member_added` (link `/projects/{id}`) — [projects.md](projects.md); `ai_alert` (trợ lý AI / bot bất thường → mọi admin, email chỉ khi bot duyệt đơn) — [ai-monitoring.md](ai-monitoring.md).

Chat dùng lại `playNotificationSound` + công tắc âm này cho tin nhắn mới ([chat.md](chat.md)); tin nhắn không tạo thông báo chuông / email, nhưng **có push** cho Direct / Room (xem mục Push ở trên).

**Webhook cá nhân** (2026-11-11): mọi chuông + tin 1-1 → POST ký HMAC tới URL của tài khoản (đánh thức agent) — [agent-team.md](agent-team.md#2-webhook-cá-nhân-module-notification--đánh-thức-agent).

**Chưa có:** tắt email theo từng nhóm (category), đẩy realtime (SignalR), gom email (digest), xoá thông báo cũ.

> Email quên mật khẩu **không** đi qua hàng đợi này (TEST-28): link chứa token bí mật, không được lưu vào bảng `notifications` / hiện ở chuông → Identity có hàng đợi riêng `identity.password_reset_requests` ([auth-sessions.md](auth-sessions.md)).
