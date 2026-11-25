# Danh mục sự kiện thông báo (TEST-59)

> Về [notifications.md](notifications.md) · Telegram: [notifications-telegram.md](notifications-telegram.md).

**Nguồn duy nhất**: `NotificationCatalog` (`backend/src/Modules/Notification/OfficeHub.Modules.Notification/Features/NotificationCatalog.cs`) — mỗi sự kiện có mã `nhóm.tên` (vd `projects.task_assigned`), nhóm, tên + mô tả tiếng Việt (ai nhận, khi nào) và nguồn phát:
- `Category` = hằng `NotificationCategories` → có **chuông** + **push** + **webhook** `notification` (Notifier luôn làm cả ba). Một category có thể tách nhiều sự kiện (vd `project_task` → giao việc, trả lại, chờ duyệt, đã duyệt, hoạt động chung, bình luận, @nhắc, sẵn sàng, đến hạn, dự án cập nhật).
- `Email`: `None` · `Optional` (nơi gửi chọn email, người nhận tắt được ở `/profile`) · `Conditional` (+ `EmailNote` bắt buộc — vd chỉ khi duyệt bước cuối) · `Always` (`account_security`, xem `EmailPolicy`). Phải khớp `SendEmail` ở nơi gọi `NotifyAsync`.
- `Telegram` = tên phương thức `ITelegramWakeup` (`TaskAssignedAsync`, `TaskReturnedAsync`, `TaskReadyAsync`, `TaskMentionedAsync`, `TaskColumnEnteredAsync`, `ChatMentionedAsync`, `MeetingTurnAsync`).
- `Push` / `WebhookEvent`: sự kiện không có chuông (tin nhắn: `chat.direct` → push + webhook `chat.message`; `chat.room` → push; kênh Office không đẩy; `chat.mention` → push + webhook `chat.mention` + Telegram, kể cả Office — TEST-70; `meetings.agent_turn` → webhook `meeting.turn` + Telegram, không push — TEST-75).

**API** (chỉ admin, ngoài allowlist token AI): `GET /api/system/notification-channels/events` → `[{ key, name, events: [{ key, title, description, category, channels: [{ channel: bell|email|push|webhook|telegram, note }] }] }]` theo thứ tự nhóm `Groups`. `note` chỉ có khi khác mặc định (email tuỳ trường hợp / luôn gửi, webhook `chat.message`). Chip "Dùng cho" của bảng 5 kênh (`GET /api/system/notification-channels`) cũng lấy từ danh mục (`NotificationCatalog.UsedBy`) — không còn danh sách riêng / "email 30 ngày qua".

**FE**: trang Hệ thống → tab Kênh thông báo, dưới bảng kênh: `components/notification-events-card` — bảng theo nhóm, cột Chuông / Email / Push / Webhook AI / Telegram (✓ + ghi chú). Chỉ hiển thị.

## Danh sách sự kiện (54, theo thứ tự `Groups`)

Mã đầy đủ = `nhóm.tên` (vd `projects.task_bot_blocked`). Kênh / email / Telegram từng sự kiện xem trong code hoặc trang Hệ thống → Kênh thông báo. Thêm / xoá sự kiện → sửa cả bảng này.

| Nhóm | Sự kiện |
|---|---|
| Phê duyệt (`approval`) | `requested` Có đơn chờ duyệt · `approved` Đơn được duyệt · `rejected` Đơn bị từ chối · `cancelled` Đơn bị huỷ · `delegation` Uỷ quyền duyệt |
| Chấm công (`attendance`) | `reminder` Nhắc chấm công |
| Nhân sự & tài khoản (`people`) | `profile_change_requested` Đề nghị sửa hồ sơ · `profile_change_approved` Hồ sơ được duyệt · `profile_change_rejected` Hồ sơ bị từ chối · `account_security` Bảo mật tài khoản |
| Hợp đồng & lương (`contracts`) | `expiring` Hợp đồng sắp hết hạn · `probation_ending` Sắp hết thử việc · `sign_requested` Chờ ký hợp đồng · `signed` Đã ký hợp đồng · `payslip_ready` Phiếu lương |
| Dự án / công việc (`projects`) | `task_assigned` Được giao việc · `task_returned` Việc bị trả lại · `task_awaiting_approval` Việc chờ duyệt · `task_approved` Việc đã duyệt · `task_activity` Hoạt động việc · `task_comment` Bình luận việc · `task_mention` Được nhắc trong việc · `task_ready` Việc sẵn sàng · `task_dependency_regressed` Việc trước bị kéo lùi · `task_bot_blocked` Bot bị chặn vì thao tác liên tiếp · `task_column_entered` Việc vào cột đánh thức bot theo dõi · `task_due` Việc đến hạn / quá hạn · `updated` Dự án được cập nhật · `wiki_share_viewed` Link chia sẻ sổ tay được mở · `member_added` Thêm vào dự án |
| Lịch họp (`meetings`) | `invited` Mời họp · `cancelled` Huỷ họp · `agent_turn` Tới lượt nói trong họp agent |
| Tài liệu (`documents`) | `retention` Hạn lưu trữ tài liệu · `handover` Bàn giao tài liệu |
| Tài sản (`assets`) | `assigned` Được cấp tài sản · `returned` Thu hồi tài sản · `expiring` Tài sản sắp hết hạn · `offboarding` Nghỉ việc còn giữ tài sản · `review` Rà soát quyền dịch vụ · `social_post` Mạng xã hội |
| Bảng tin (`news`) | `published` Bài viết mới · `comment` Bình luận bảng tin · `mention` Được nhắc tên · `moderated` Bài bị ẩn / gỡ |
| Kinh doanh (`sales`) | `receivable_due` Đợt thu đến hạn · `customer_follow_up` Chăm sóc khách hàng · `change_request_approved` Yêu cầu thay đổi được duyệt |
| Tài chính (`finance`) | `expense_ready` Đề nghị chi chờ chi · `expense_paid` Đã chi tiền |
| Tin nhắn (`chat`) | `direct` Tin nhắn 1-1 · `room` Tin nhắn kênh phòng · `mention` Được nhắc trong tin nhắn |
| Hệ thống (`system`) | `ai_alert` Cảnh báo trợ lý AI |

## Bắt buộc đồng bộ khi thêm / xoá sự kiện

Thêm / đổi / xoá nơi phát thông báo → sửa `NotificationCatalog` **trong cùng commit**:
- Hằng mới trong `NotificationCategories` → thêm ≥ 1 sự kiện có `Category` đó; hằng không còn nơi nào dùng → xoá hằng + sự kiện.
- Phương thức mới trong `ITelegramWakeup` → sự kiện có `Telegram = nameof(...)`; `WebhookEvents` mới → sự kiện có `WebhookEvent` (trừ `ping` — kỹ thuật).
- Gọi `NotifyAsync` với category là **hằng**, không viết chuỗi.
- Tách thêm sự kiện trong cùng category (vd thông báo dự án mới) → thêm dòng vào danh mục dù test không bắt được (test chỉ đối chiếu theo category).

`tests/OfficeHub.Modules.Notification.Tests/NotificationCatalogTests.cs` quét `backend/src` (bỏ `obj/` `bin/`) và **fail** khi: category chưa có trong danh mục / danh mục còn category không tồn tại, hằng `NotificationCategories` không còn nơi dùng, `new NotificationRequest(…, "chuỗi"…)`, `ITelegramWakeup` / `WebhookEvents` lệch danh mục hoặc không còn nơi gọi, mã trùng, nhóm chưa khai báo, email `Conditional` thiếu ghi chú.

E2E: `scripts/dev/notification-channels-e2e.ts` (quyền `/events`, nhóm, kênh từng sự kiện, chip "Dùng cho") — 23/23 (2026-11-12).
