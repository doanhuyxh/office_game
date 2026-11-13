# Kênh Telegram — đánh thức agent (TEST-42, @nhắc: TEST-63, hết chờ: TEST-86)

> Về [notifications.md](notifications.md) · cấu hình lưu DB: [../env.md](../env.md#cấu-hình-lưu-trong-db-test-41) · bối cảnh agent: [agent-team.md](agent-team.md)

**Mục đích:** khi một việc được **giao cho tài khoản bot** (cờ IsBot), OfficeHub gửi **đúng một tin** vào một nhóm Telegram. Bộ điều phối trên máy chạy agent đọc tin rồi cho agent làm việc đó (TEST-44). Hiện có sáu sự kiện: **giao việc**, **trả lại việc** (lùi kèm lý do), **việc hết phải chờ** (TEST-86), **bot được @nhắc trong bình luận việc**, **bot được @nhắc trong tin nhắn chat** (TEST-70) và **bot tới lượt nói trong họp agent** (TEST-75); thông báo khác chưa đi qua Telegram. Thêm sự kiện Telegram = thêm phương thức `ITelegramWakeup` **và** dòng trong danh mục sự kiện ([notifications-catalog.md](notifications-catalog.md), test bắt buộc).

## Cấu hình

- Trang Hệ thống → Cấu hình → khung **Telegram (đánh thức agent)** = nhóm `telegram` trong `settings.system_settings`: `enabled`, `chatId` (số, nhóm dạng `-100…`, hoặc `@tenkenh`), bí mật `botToken` (dạng `123456789:AA…`, mã hoá, API không trả lại). Bật thì bắt buộc đủ chat id + token; tắt thì lưu trống được. Không có biến `.env` (chưa lưu = chưa cấu hình). Nút **Gửi thử** gửi ngay một tin thử (không qua hàng đợi).
- Không gán bot Telegram theo từng nhân sự (TEST-48 bỏ trường `identity.users.TelegramBot`, API `PUT …/account/telegram` và menu "Bot Telegram…"; migration `DropUserTelegramBot` xoá cột). Agent đọc nhóm và tự nhận việc theo `employee_code` trong JSON.

## Khi nào gửi

`TaskEndpoints` (Projects) → `NotifyAssignedAsync` → `ITelegramWakeup.TaskAssignedAsync` (Notification.Contracts) mỗi khi tạo việc có người làm hoặc **đổi** người làm — mọi đường (web, token AI, MCP `create_task` / `update_task`) đều qua đây. Bỏ qua khi: người thao tác tự giao cho mình, kênh tắt / thiếu cấu hình, người nhận không phải bot / đã khoá. Sửa việc mà không đổi người → không gửi.

**Trả lại việc:** `NotifyMovedAsync` → `ITelegramWakeup.TaskReturnedAsync` khi việc lùi kèm lý do (`MoveNotice.Returned`, vd Review → Cần làm) và người làm là bot, không phải người thao tác. Tin `event: returned` (hàng đợi `Kind = task_returned`); runner kiểm tra lại việc qua MCP rồi làm lại, đọc lý do ở bình luận / chuông. Duyệt xong (Done) không gửi.

**Hết chờ (TEST-86):** việc vừa sang cột hoàn thành → `NotifyUnblockedAsync` (đúng chỗ phát chuông "Sẵn sàng") → `ITelegramWakeup.TaskReadyAsync` cho mỗi việc chờ nó mà nay hết chờ, **chỉ khi việc có người làm** và người làm không phải người thao tác. Việc chưa giao (chuông đi tới quản lý dự án) / còn chờ việc khác → không gửi. Tin `event: ready` (hàng đợi `Kind = task_ready`), cùng 4 trường như giao việc → runner hiện tại nhận ngay (kiểm tra lại việc qua MCP). Một lần chuyển Xong → mỗi việc hết chờ đúng một tin; việc trước bị mở lại rồi Xong lần nữa có thể gửi lại (runner có khoá theo `task_id`).

**Được @nhắc (TEST-63):** `AddCommentAsync` → `ITelegramWakeup.TaskMentionedAsync` cho mỗi thành viên dự án được `@mã-NV` (`AgentTeamRules.MentionWakeTargets`): còn làm việc, có tài khoản, **không phải người viết** (bot tự nhắc mình → không gửi); **gồm cả người làm việc** (chuông bình luận không đánh thức agent). Người thật / bot đã khoá bị bỏ trong `TelegramWakeup` như các sự kiện khác. Tin `event: mentioned` + `comment_id` (hàng đợi `Kind = task_mentioned`). Bot nhắc bot vẫn bị chặn vòng lặp bởi `StreakErrorAsync` (bình luận bị 409 → không có tin).

**Được @nhắc trong chat (TEST-70):** `ChatEndpoints` (gửi / sửa tin ở Office / Room / Group) → `ITelegramWakeup.ChatMentionedAsync` cho mỗi người được nhắc (đã lọc thành viên, bỏ người gửi); bỏ hẳn khi người gửi là bot (chống vòng lặp). Tin `{"employee_code","event":"chat_mention","conversation_id","message_id"}` — **không** có task_id / nội dung (`TelegramRules.ChatWakeMessage`; hàng đợi `Kind = chat_mention`, `TaskId` trống). Agent đọc bằng MCP `read_chat`. **Runner** (TEST-81) kiểm tra lại bằng `list_chats` (còn tin nhắc chưa đọc) rồi mở phiên ngắn chỉ có tool MCP để trả lời — [agent-runner-events.md](agent-runner-events.md).

**Tới lượt nói trong họp agent (TEST-75):** `AgentMeetingTurnService` → `ITelegramWakeup.MeetingTurnAsync` chỉ cho bot vừa nhận lượt ([meetings-agents.md](meetings-agents.md#lượt-nói-test-75)). Tin `{"employee_code","event":"meeting_turn","session_id","conversation_id"}` (`TelegramRules.MeetingWakeMessage`; hàng đợi `Kind = meeting_turn`, `TaskId` trống) — không nội dung; agent đọc kênh phòng bằng `read_chat`. Runner hiện bỏ qua tin này (TEST-84 chưa làm).

Tin = một dòng JSON (không nhắc bot, không có tên / mô tả việc / nội dung bình luận — agent tự đọc qua MCP):
```
{"employee_code":"NV012","project_id":"…","task_id":"…","task_code":"TEST-35","event":"assigned"}
{"employee_code":"NV018","project_id":"…","task_id":"…","task_code":"TEST-75","event":"ready"}
{"employee_code":"NV018","project_id":"…","task_id":"…","task_code":"TEST-63","event":"mentioned","comment_id":"…"}
```
`event` = `assigned` / `returned` / `ready` / `mentioned` (hằng `TelegramRules.Assigned/Returned/Ready/Mentioned`); tin cũ không có `event` = `assigned`. (`TelegramRules.WakeMessage`, test ở `TelegramRulesTests`.)
**Runner:** `agent-runner/` hiện bỏ qua `event` / `comment_id` (chỉ đọc 4 trường) — tin `mentioned` cho bot không phải người làm bị bỏ ("việc không còn giao cho agent này"); bot là người làm thì mở phiên làm việc bình thường. Xử lý riêng `mentioned` (chỉ trả lời bằng `comment_task`) do người thật sửa runner — xem [agent-runner.md](agent-runner.md#chưa-làm-bước-sau-của-test-44).

## Gửi nền (`Infrastructure/Telegram.cs`)

- Hàng đợi `notifications.telegram_messages` (Pending / Sent / Failed, `Attempts`, `NextAttemptAt`, `ResponseStatus`, `Error`; giữ 30 ngày). `TelegramDispatcher` quét mỗi 3 giây (job `notification.telegram` ở trang Vận hành). Lỗi khi đưa vào hàng đợi chỉ ghi log — giao việc luôn thành công.
- `sendMessage` qua `TelegramClient`: lỗi mạng / 429 (theo `retry_after`) / 5xx → thử lại tối đa 5 lần (30 giây → 2 → 10 → 30 phút); 4xx khác (token sai 401, chat sai 400, bot bị đuổi 403) → Failed ngay. Lúc gửi kênh đã tắt → Failed "Kênh Telegram đã tắt".
- **Không lộ token:** URL Bot API chứa token → HttpClient `officehub-telegram` dùng `RemoveAllLoggers()`; thông điệp lỗi thay token bằng `***`; token không lưu trong hàng đợi (đọc cấu hình lúc gửi).
- `Telegram__ApiUrl` (mặc định `https://api.telegram.org`) chỉ để trỏ máy chủ giả khi test.

## Kiểm thử

`scripts/dev/telegram-e2e.ts` (Telegram giả trong tiến trình) — xem [../e2e.md](../e2e.md).
