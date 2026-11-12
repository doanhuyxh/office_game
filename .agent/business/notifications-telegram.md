# Kênh Telegram — đánh thức agent (TEST-42)

> Về [notifications.md](notifications.md) · cấu hình lưu DB: [../env.md](../env.md#cấu-hình-lưu-trong-db-test-41) · bối cảnh agent: [agent-team.md](agent-team.md)

**Mục đích:** khi một việc được **giao cho tài khoản bot** (cờ IsBot), OfficeHub gửi **đúng một tin** vào một nhóm Telegram. Bộ điều phối trên máy chạy agent đọc tin rồi cho agent làm việc đó (TEST-44). Hiện chỉ sự kiện **giao việc**; thông báo khác chưa đi qua Telegram.

## Cấu hình

- Trang Hệ thống → Cấu hình → khung **Telegram (đánh thức agent)** = nhóm `telegram` trong `settings.system_settings`: `enabled`, `chatId` (số, nhóm dạng `-100…`, hoặc `@tenkenh`), bí mật `botToken` (dạng `123456789:AA…`, mã hoá, API không trả lại). Bật thì bắt buộc đủ chat id + token; tắt thì lưu trống được. Không có biến `.env` (chưa lưu = chưa cấu hình). Nút **Gửi thử** gửi ngay một tin thử (không qua hàng đợi).
- Không gán bot Telegram theo từng nhân sự (TEST-48 bỏ trường `identity.users.TelegramBot`, API `PUT …/account/telegram` và menu "Bot Telegram…"; migration `DropUserTelegramBot` xoá cột). Agent đọc nhóm và tự nhận việc theo `employee_code` trong JSON.

## Khi nào gửi

`TaskEndpoints` (Projects) → `NotifyAssignedAsync` → `ITelegramWakeup.TaskAssignedAsync` (Notification.Contracts) mỗi khi tạo việc có người làm hoặc **đổi** người làm — mọi đường (web, token AI, MCP `create_task` / `update_task`) đều qua đây. Bỏ qua khi: người thao tác tự giao cho mình, kênh tắt / thiếu cấu hình, người nhận không phải bot / đã khoá. Sửa việc mà không đổi người → không gửi.

Tin = một dòng JSON (không nhắc bot, không có tên / mô tả việc — agent tự đọc qua MCP):
```
{"employee_code":"NV012","project_id":"…","task_id":"…","task_code":"TEST-35"}
```
(`TelegramRules.WakeMessage`, test ở `TelegramRulesTests`.)

## Gửi nền (`Infrastructure/Telegram.cs`)

- Hàng đợi `notifications.telegram_messages` (Pending / Sent / Failed, `Attempts`, `NextAttemptAt`, `ResponseStatus`, `Error`; giữ 30 ngày). `TelegramDispatcher` quét mỗi 3 giây (job `notification.telegram` ở trang Vận hành). Lỗi khi đưa vào hàng đợi chỉ ghi log — giao việc luôn thành công.
- `sendMessage` qua `TelegramClient`: lỗi mạng / 429 (theo `retry_after`) / 5xx → thử lại tối đa 5 lần (30 giây → 2 → 10 → 30 phút); 4xx khác (token sai 401, chat sai 400, bot bị đuổi 403) → Failed ngay. Lúc gửi kênh đã tắt → Failed "Kênh Telegram đã tắt".
- **Không lộ token:** URL Bot API chứa token → HttpClient `officehub-telegram` dùng `RemoveAllLoggers()`; thông điệp lỗi thay token bằng `***`; token không lưu trong hàng đợi (đọc cấu hình lúc gửi).
- `Telegram__ApiUrl` (mặc định `https://api.telegram.org`) chỉ để trỏ máy chủ giả khi test.

## Kiểm thử

`scripts/dev/telegram-e2e.ts` (Telegram giả trong tiến trình) — xem [../e2e.md](../e2e.md).
