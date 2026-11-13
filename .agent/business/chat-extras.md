# Tin nhắn: sửa tin, cảm xúc, tìm, nhóm tuỳ chọn (TEST-54), @nhắc (TEST-70)

> Phần mở rộng của [chat.md](chat.md) (kiến trúc, quyền, schema gốc). Code: `backend/src/Modules/Chat/` (`ChatEndpoints` — EditAsync / ReactAsync / SearchAsync / *Group*), `OfficeHub.Realtime/Hubs/ChatHub.cs` (`Edit`, `React`), `frontend/src/features/chat/`.

Chủ dự án chốt 2026-11-12 (đừng hỏi lại): sửa tin **không quá 24 giờ** sau khi gửi; cảm xúc **emoji tự do**; **ai cũng tạo được** nhóm chat. Giới hạn tự đặt (chưa chủ dự án xác nhận): nhóm ≤ **100** người, ≤ **20** loại emoji / tin, tìm ≤ **50** kết quả.

## Sửa tin

`PATCH /api/chat/messages/{id}` `{text}` — chỉ người gửi, tin chưa thu hồi, `now − createdAt ≤ 24h` (`ChatRules.EditWindow`, quá → **409**); cùng quy tắc nội dung như gửi (≤ 1000 ký tự, tin không tệp phải còn chữ → 400); tệp giữ nguyên. Đổi chữ → `messages.EditedAt` (FE hiện "(đã sửa)"); là tin mới nhất → cập nhật `LastPreview`. Không lưu lịch sử các bản sửa. Người khác / người ngoài → 404.

## Cảm xúc

`POST /api/chat/messages/{id}/reactions` `{emoji}` = bật / tắt: người đó đã thả emoji này → gỡ, chưa → thêm. Mọi thành viên hội thoại (kể cả tin của mình); tin thu hồi → 404. Emoji hợp lệ (`ChatRules.NormalizeEmoji`): đúng **một** grapheme (👍🏽, 👨‍👩‍👧, 🇻🇳 đều được), ≤ 32 ký tự UTF-16, có ít nhất một ký hiệu Unicode `So`, không chữ / khoảng trắng / ký tự điều khiển (keycap 1️⃣ bị từ chối). Bảng `chat.reactions (MessageId, UserId, Emoji)` khoá chính ba cột, xoá dây chuyền theo tin. `MessageDto.reactions = [{emoji, userIds}]` theo thứ tự lần đầu được thả (client tự xét "của tôi"); tin thu hồi trả rỗng. FE: menu tin có 6 emoji nhanh + "Emoji khác…" (ô nhập tự do), chip dưới bong bóng bấm để thả / gỡ.

## Tìm trong tin nhắn

`GET /api/chat/conversations/{id}/search?q=` — trong một hội thoại mình xem được (Office / Room / Direct / Group), `ILIKE` chứa chuỗi (không phân biệt hoa thường, **có** phân biệt dấu; `%` `_` `\` được thoát — `ChatRules.LikeContains`), bỏ tin thu hồi, mới nhất trước, tối đa 50; `q` < 2 ký tự → 400. Không phải tìm toàn văn — OCR / tìm toàn văn để việc TEST-61. FE: nút kính lúp ở đầu khung chat.

## Nhóm tuỳ chọn (`ConversationType.Group`)

| Method | Path | Kết quả |
|---|---|---|
| POST | `/conversations/group` `{title, userIds}` | tạo nhóm (tên ≤ 100, ≥ 1 người khác, tài khoản phải đang hoạt động → 400) — người tạo + người được mời thành thành viên |
| GET | `/conversations/{id}/members` | `[{userId, fullName, code, isCreator}]` |
| POST | `/conversations/{id}/members` `{userIds}` | **thành viên nào cũng thêm được** người; người mới có `read_states` = tin mới nhất (lịch sử cũ không tính chưa đọc); thêm lại người đã có → 204 |
| DELETE | `/conversations/{id}/members/me` | rời nhóm (xoá thành viên + đã đọc); không có xoá nhóm / đuổi người |

Lưu ở `conversations` (`Title`, `CreatedBy`) + thành viên ở `room_members` (dùng chung với kênh phòng → `CanAccessAsync` / `RecipientsAsync` / `VisibleAsync` không cần nhánh riêng). Người ngoài nhóm → 404 mọi route. Như Direct: push FCM cho người nhận, không vào HUD 3D, không webhook. **Bot (token AI) không dùng nhóm** (`ChatRules.BotCanUse`), các route mới đều không có trong danh sách route token (`AccessTokenAuth`) → 403.

## Realtime

Hub `/rt/hub/chat`: `Edit(messageId, text)` và `React(messageId, emoji)` gọi Api bằng cookie kết nối rồi phát **`MessageUpdated(ChatMessageDto)`** cho người nhận (Office: mọi kết nối; còn lại: thành viên + người thao tác). `ChatMessageDto` thêm `EditedAt`, `Reactions[]`. Client thay tin cùng `id` trong cache; hub chưa nối → REST (người khác thấy khi tải lại). HUD 3D không đổi.

## @nhắc trong tin (TEST-70)

Cú pháp **`@<mã NV>`** như bình luận việc (regex chung `BuildingBlocks/Text/MentionCodes`, FE `utils/mention.ts`). Có ở Office / Room / Group; **1-1 không** (`ChatRules.CanMention`).
- **Lưu**: gửi / sửa tin → `ChatRules.MentionTargets` giữ mã khớp **thành viên hội thoại** (Office = mọi nhân viên đang làm có tài khoản; Room / Group = `room_members`), bỏ người gửi, bỏ trùng, ≤ **10** người → cột `messages.MentionedUserIds uuid[]` (migration `ChatMentions`). `MessageDto.mentions = [{userId, code, name}]` (tên hiện tại; người đã nghỉ bị bỏ → FE hiện chữ thường). Sửa tin tính lại; chỉ người **mới** được nhắc nhận thông báo.
- **Gợi ý**: `GET /conversations/{id}/mention-candidates?search=` → `[{userId, fullName, code, isBot, avatarUrl, departmentName, title}]` ≤ **20**, trừ mình; 1-1 → `[]`; người ngoài → 404; không trong route token AI (403). Tìm + xếp hạng chung với Bảng tin (TEST-71, [news-extras.md](news-extras.md)): Office → `IEmployeeDirectory.SearchActiveAsync` (lọc trong DB, có chức danh); Room / Group → `PersonSearch.Search` trên thành viên (`title` = null).
- **Đếm**: `ConversationDto.mentionedUnread` = số tin chưa đọc nhắc tới tôi (FE chấm "@" cạnh số chưa đọc; MCP `list_chats`).
- **Thông báo** (vẫn **không chuông / email**): push FCM "… nhắc bạn · nơi" cho người được nhắc, **kể cả Office** (Room / Group: thay push thường, không đẩy hai lần). Người gửi **không phải bot** → thêm webhook `chat.mention` + Telegram `event: chat_mention` (chỉ tài khoản bot nhận — [notifications-telegram.md](notifications-telegram.md)). Người gửi là bot (token AI **hoặc** tài khoản bot trên web) → không webhook / Telegram (chống vòng lặp bot ↔ bot; vẫn lưu mentions + push). Ngoại lệ duy nhất: phiên họp agent — bot được nhắc nhận lượt + `meeting_turn` ([meetings-agents.md](meetings-agents.md#lượt-nói-test-75)), không kèm `chat_mention`. Kênh phòng đang họp: bot chỉ nhắn khi giữ lượt (409).
- **FE**: `composer` gõ @ (chờ 200 ms, gõ họ tên có dấu cách — [frontend-ui.md](../frontend-ui.md)) → `MentionList` + `useMentionNav` (BOT chip), chọn chèn `@MÃ`; `message-item` thay `@mã` → `@Họ tên` tô nổi, tin nhắc mình nền / viền `warning` (`data-mentions-me`); HUD 3D (`ChatDto.mentions` qua Realtime) tô tên + nhấn dòng nhắc mình.
- Chuông in-app cho @nhắc chat: **chưa thêm** (task hỏi chủ dự án, mặc định không).

## Test

`OfficeHub.Modules.Chat.Tests/ChatMentionTests.cs`, `OfficeHub.Modules.Chat.Tests/ChatEditReactGroupTests.cs`, `OfficeHub.Realtime.Tests/ChatRoutingTests.cs`; e2e `scripts/dev/chat-extra-e2e.ts` (51 kiểm tra, có phần Realtime khi đặt `RT_URL`), `scripts/dev/chat-mention-e2e.ts` (TEST-70) — [e2e.md](../e2e.md).
