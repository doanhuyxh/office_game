# Kênh Telegram — đánh thức agent (TEST-42)

> Về [notifications.md](notifications.md) · cấu hình lưu DB: [../env.md](../env.md#cấu-hình-lưu-trong-db-test-41) · bối cảnh agent: [agent-team.md](agent-team.md)

**Mục đích:** khi một việc được **giao cho tài khoản bot** có "Bot Telegram", OfficeHub gửi **đúng một tin** vào một nhóm Telegram. Bộ điều phối trên máy chạy agent đọc tin rồi cho agent làm việc đó (TEST-44). Hiện chỉ sự kiện **giao việc**; thông báo khác chưa đi qua Telegram.

## Cấu hình

- Trang Hệ thống → Cấu hình → khung **Telegram (đánh thức agent)** = nhóm `telegram` trong `settings.system_settings`: `enabled`, `chatId` (số, nhóm dạng `-100…`, hoặc `@tenkenh`), bí mật `botToken` (dạng `123456789:AA…`, mã hoá, API không trả lại). Bật thì bắt buộc đủ chat id + token; tắt thì lưu trống được. Không có biến `.env` (chưa lưu = chưa cấu hình). Nút **Gửi thử** gửi ngay một tin thử (không qua hàng đợi).
- Phải bật **Bot-to-Bot Communication Mode** trong @BotFather cho bot thông báo của OfficeHub và bot của agent, thêm cả hai vào nhóm.
- Mỗi tài khoản bot: trường **Bot Telegram** (`identity.users.TelegramBot`, "@…bot" chữ thường, unique). Chỉ **admin** đặt: `PUT /api/org/employees/{id}/account/telegram { telegramBot }` (trống = gỡ); tài khoản chưa đánh dấu bot → 409, username sai (5–32 ký tự, kết thúc `bot`) → 400, bot đã gắn tài khoản khác → 409. FE: Nhân viên → menu ⋯ → "Bot Telegram…" (chỉ admin, chỉ tài khoản bot).

## Khi nào gửi

`TaskEndpoints` (Projects) → `NotifyAssignedAsync` → `ITelegramWakeup.TaskAssignedAsync` (Notification.Contracts) mỗi khi tạo việc có người làm hoặc **đổi** người làm — mọi đường (web, token AI, MCP `create_task` / `update_task`) đều qua đây. Bỏ qua khi: người thao tác tự giao cho mình, kênh tắt / thiếu cấu hình, người nhận không phải bot / đã khoá / chưa có username. Sửa việc mà không đổi người → không gửi.

Tin (không có tên / mô tả việc — agent tự đọc qua MCP):
```
@agent_dev01_bot
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
