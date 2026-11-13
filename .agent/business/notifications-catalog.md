# Danh mục sự kiện thông báo (TEST-59)

> Về [notifications.md](notifications.md) · Telegram: [notifications-telegram.md](notifications-telegram.md).

**Nguồn duy nhất**: `NotificationCatalog` (`backend/src/Modules/Notification/OfficeHub.Modules.Notification/Features/NotificationCatalog.cs`) — mỗi sự kiện có mã `nhóm.tên` (vd `projects.task_assigned`), nhóm, tên + mô tả tiếng Việt (ai nhận, khi nào) và nguồn phát:
- `Category` = hằng `NotificationCategories` → có **chuông** + **push** + **webhook** `notification` (Notifier luôn làm cả ba). Một category có thể tách nhiều sự kiện (vd `project_task` → giao việc, trả lại, chờ duyệt, đã duyệt, hoạt động chung, bình luận, @nhắc, sẵn sàng, đến hạn, dự án cập nhật).
- `Email`: `None` · `Optional` (nơi gửi chọn email, người nhận tắt được ở `/profile`) · `Conditional` (+ `EmailNote` bắt buộc — vd chỉ khi duyệt bước cuối) · `Always` (`account_security`, xem `EmailPolicy`). Phải khớp `SendEmail` ở nơi gọi `NotifyAsync`.
- `Telegram` = tên phương thức `ITelegramWakeup` (`TaskAssignedAsync`, `TaskReturnedAsync`, `TaskMentionedAsync`, `ChatMentionedAsync`).
- `Push` / `WebhookEvent`: sự kiện không có chuông (tin nhắn: `chat.direct` → push + webhook `chat.message`; `chat.room` → push; kênh Office không đẩy; `chat.mention` → push + webhook `chat.mention` + Telegram, kể cả Office — TEST-70).

**API** (chỉ admin, ngoài allowlist token AI): `GET /api/system/notification-channels/events` → `[{ key, name, events: [{ key, title, description, category, channels: [{ channel: bell|email|push|webhook|telegram, note }] }] }]` theo thứ tự nhóm `Groups`. `note` chỉ có khi khác mặc định (email tuỳ trường hợp / luôn gửi, webhook `chat.message`). Chip "Dùng cho" của bảng 5 kênh (`GET /api/system/notification-channels`) cũng lấy từ danh mục (`NotificationCatalog.UsedBy`) — không còn danh sách riêng / "email 30 ngày qua".

**FE**: trang Hệ thống → tab Kênh thông báo, dưới bảng kênh: `components/notification-events-card` — bảng theo nhóm, cột Chuông / Email / Push / Webhook AI / Telegram (✓ + ghi chú). Chỉ hiển thị.

## Bắt buộc đồng bộ khi thêm / xoá sự kiện

Thêm / đổi / xoá nơi phát thông báo → sửa `NotificationCatalog` **trong cùng commit**:
- Hằng mới trong `NotificationCategories` → thêm ≥ 1 sự kiện có `Category` đó; hằng không còn nơi nào dùng → xoá hằng + sự kiện.
- Phương thức mới trong `ITelegramWakeup` → sự kiện có `Telegram = nameof(...)`; `WebhookEvents` mới → sự kiện có `WebhookEvent` (trừ `ping` — kỹ thuật).
- Gọi `NotifyAsync` với category là **hằng**, không viết chuỗi.
- Tách thêm sự kiện trong cùng category (vd thông báo dự án mới) → thêm dòng vào danh mục dù test không bắt được (test chỉ đối chiếu theo category).

`tests/OfficeHub.Modules.Notification.Tests/NotificationCatalogTests.cs` quét `backend/src` (bỏ `obj/` `bin/`) và **fail** khi: category chưa có trong danh mục / danh mục còn category không tồn tại, hằng `NotificationCategories` không còn nơi dùng, `new NotificationRequest(…, "chuỗi"…)`, `ITelegramWakeup` / `WebhookEvents` lệch danh mục hoặc không còn nơi gọi, mã trùng, nhóm chưa khai báo, email `Conditional` thiếu ghi chú.

E2E: `scripts/dev/notification-channels-e2e.ts` (quyền `/events`, nhóm, kênh từng sự kiện, chip "Dùng cho") — 23/23 (2026-11-12).
