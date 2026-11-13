# Tin nhắn (module Chat)

> Nguồn sự thật là code: `backend/src/Modules/Chat/`, `backend/src/OfficeHub.Realtime/Chat/` + `Hubs/ChatHub.cs`, `frontend/src/features/chat/`. Về [README.md](README.md). Chat HUD trong 3D: [office.md](office.md).

Chủ dự án chốt 2026-11-07 (đừng hỏi lại): chat ra ngoài 3D, **đồng bộ** với chat 3D, thêm chat 1-1; lưu **vĩnh viễn**, thu hồi = **xoá mềm**; admin / HR **không** đọc tin 1-1; tệp ở thư mục S3 riêng; chỉ badge + âm báo, **không chuông / email** (quyết định chống spam, vẫn giữ); **không** mở cho AI — *đổi 2026-11-11*: **tài khoản bot** được nhắn Toàn văn phòng + 1-1 người khác mở, nhãn BOT ([office-bots.md](office-bots.md#tin-nhắn-của-bot)); người thật dùng token vẫn 403. Có **push FCM** (chốt 2026-11-08) cho Direct / Room, không cho Office (trừ người được @nhắc — TEST-70) — [notifications.md](notifications.md#push-fcm).

## Kiến trúc

```
Trình duyệt ──WS /rt/hub/chat──▶ Realtime (ChatHub: chuyển tiếp + phát) ──/api/chat/… (cookie người dùng)──▶ Api · module Chat (lưu DB, quyền)
HUD 3D (OfficeRoomHub.SendChat / SendRoomChat) ──cùng đường ChatApi → ChatFanout──▶ ChatHub + HUD 3D
Realtime ──POST /api/chat/internal/rooms/{id}/members (X-Chat-Key)──▶ Api   (chỉ cấp thành viên kênh phòng)
```

Api là nguồn sự thật (lưu, quyền, giới hạn 1 tin / giây / tài khoản — `ChatThrottle`). Realtime không ghi DB, gọi Api bằng **cookie của kết nối**. Người nhận do Api trả (`recipients`: `null` = Office, còn lại = nhóm `u:{userId}` + người gửi). Nhiều kết nối / tài khoản (không đá kết nối cũ như hub văn phòng). `Chat__InternalKey` ([env.md](../env.md)) chỉ để Realtime báo "người này vừa vào phòng X" (Api không biết vị trí 3D); so sánh thời gian cố định, thiếu khoá → không khớp.

## Schema `chat`

| Bảng (migration `InitialChat`) | Nội dung |
|---|---|
| `conversations` | `Type` (Office / Room / Direct), `RoomId`, `UserLowId` < `UserHighId`, `LastSeq`, `LastMessageAt`, `LastPreview` (bản sao để liệt kê). Unique: một Office, một dòng / `RoomId`, một dòng / cặp |
| `room_members` | `(ConversationId, UserId)`, `JoinedAt` — người từng ở trong phòng / thành viên nhóm |
| `messages` | `Id` (v7), `Seq` (identity, con trỏ cuộn), `ConversationId`, `SenderId`, `SenderName` (snapshot), `Text` ≤ 1000, `CreatedAt`, `DeletedAt` (xoá mềm), `ClientId` (unique cùng hội thoại + người gửi), `ByBot` (token bot — migration `ChatByBot`), `MentionedUserIds uuid[]` (@nhắc — `ChatMentions`, [chat-extras.md](chat-extras.md#nhắc-trong-tin-test-70)) |
| `attachments` | `MessageId`, `FileKey`, `FileName`, `ContentType`, `Size`, `IsImage` |
| `read_states` | `(ConversationId, UserId)`, `LastReadSeq` |
| `upload_tickets` | vé tải lên chưa gắn tin (dọn cả file S3 sau 24 giờ khi có vé mới) |

## Hội thoại

| Loại | Ai thấy / gửi | Ghi chú |
|---|---|---|
| `Office` | mọi tài khoản | tên "Toàn văn phòng"; bí danh `office` |
| `Room` | **thành viên** (từng đứng trong phòng ở 3D) | mỗi phòng có tường trong `shared/office-map.json` một kênh (tạo lúc khởi động, `ChatMigrator`); bí danh `room:<id>`; thành viên gửi được cả từ web |
| `Direct` | đúng hai người | người ngoài (kể cả admin / HR) nhận **404** |
| `Group` | thành viên (ai cũng tạo được) | [chat-extras.md](chat-extras.md#nhóm-tuỳ-chọn-conversationtypegroup) |

Thành viên phòng: Realtime báo khi người chơi **bước vào** phòng có tường (`OfficeRoomHub.Move`, không chặn, lỗi chỉ log) và trước khi gửi tin phòng; xem được lịch sử cũ nhưng không bị tính chưa đọc. Khu mở không tường không có kênh.

## API (`/api/chat`, đăng nhập; enum dạng chuỗi)

| Method | Path | Kết quả |
|---|---|---|
| GET | `/conversations` | Office đầu, còn lại theo tin mới nhất: `id, type, title, roomId, peerUserId, lastMessageAt, lastPreview, unread` |
| GET | `/unread-count` · `/people?search=` | `{count}` · ≤ 20 người để nhắn 1-1 (tìm không dấu theo tên / mã) |
| POST | `/conversations/direct` `{userId}` | lấy hoặc tạo 1-1 (chính mình 400, tài khoản khoá 404) |
| GET | `/conversations/{id}/messages?before=&take=` | `{items (tăng dần seq), hasMore}` — con trỏ `seq` thay `page/pageSize` (tin mới chen vào làm lệch trang) |
| POST | `/conversations/{id}/messages` `{text?, uploadIds?, clientId?}` | `SendResultDto` (`message, conversationType, roomId, roomName, recipients`) |
| DELETE | `/messages/{id}` · POST `/conversations/{id}/read` | thu hồi (chỉ người gửi; lặp lại = 200) · đã đọc → 204 |
| POST | `/uploads` · GET `/attachments/{id}/url?download=` | vé + presigned PUT 30 phút · link tải mới (404 nếu tin thu hồi / không phải thành viên) |
| POST | `/internal/rooms/{roomId}/members` | `AllowAnonymous` + `X-Chat-Key`, 204 idempotent, sai khoá 401 |

`id` hội thoại: Guid, `office` hoặc `room:<id>`. Quy tắc (`Domain/ChatRules.cs`): trim, ≤ **1000** ký tự, cần chữ hoặc ≥ 1 tệp, ≤ **5** tệp; < 1 giây → **429**; gửi lại cùng `clientId` → trả tin cũ. **Chưa đọc** = tin người khác, chưa thu hồi, `Seq` > `LastReadSeq`; Office khởi tạo ở tin mới nhất khi xem lần đầu, Room khi vào phòng, Direct bắt đầu từ 0. **Thu hồi**: API ẩn chữ + tệp (`deleted: true`) nhưng dòng và file S3 vẫn giữ. Sửa tin (24 giờ), cảm xúc, tìm: [chat-extras.md](chat-extras.md).

## Tệp đính kèm

`POST /uploads` → trình duyệt `PUT` thẳng S3 với đúng `Content-Type` (cần CORS — [env.md](../env.md#s3-cors-kho-tài-liệu)) → gửi tin kèm `uploadIds`, Api `HEAD` kiểm tra file đã lên + dung lượng. Khoá `chat/{yyyy}/{MM}/{vé}/{tên-an-toàn}` (dưới `files/` của `IFileStorage`), **không** chung `documents/`. Ảnh (jpeg / png / webp / gif) ≤ **10 MB**, tệp khác ≤ **25 MB**, chặn đuôi chạy chương trình; SVG tải về, không xem trực tiếp. `AttachmentDto.url` = presigned GET 60 phút (ảnh `inline`).

## Realtime (`/rt/hub/chat`, MessagePack)

`Send(conversationId, text?, uploadIds?, clientId?)` → `ChatMessageDto` và `Delete(messageId)`; server → client `Message`, `MessageDeleted(conversationId, messageId)`, `Kicked`. Lỗi Api → `HubException(detail)`. Tin tới cả kết nối của người gửi → client khử trùng theo `id` / `clientId`. Kết nối bị `Abort` nếu phải đổi mật khẩu / chưa bật 2FA; `ChatSessionWatch` kiểm tra cookie mỗi `Realtime__SessionCheckSeconds`. Vào HUD 3D (`ChatFanout`): Office → nhóm `office`; Room → người đang đứng trong phòng; Direct + tin thu hồi không vào 3D; tin chỉ có tệp hiện `[Ảnh] tên` / `[Tệp] tên`. HUD vẫn cắt 200 ký tự.

## Front-end (`features/chat/`)

`ChatProvider` (trong `MainLayout`, không ở `/office`) giữ một kết nối, tự nối lại và bù tin lỡ; gửi lạc quan bằng `clientId`; hub chưa nối thì gửi qua REST. Trang `/chat`: danh sách + khung chat, "Tin nhắn mới", kéo-thả / dán ảnh, xem ảnh lớn, "Thu hồi", mobile hai màn hình; hội thoại đang mở nằm trên URL `?c=<id>` (reload / gửi link giữ nguyên), bản nháp chưa gửi giữ theo hội thoại trong `sessionStorage` (`chat-draft:<id>`); nút có badge ở `Header` + mục "Tin nhắn" ở sidebar. **Âm báo** dùng lại `playNotificationSound` ([notifications.md](notifications.md)): tin người khác khi hội thoại không đang mở / hiển thị → phát; mở app mà còn chưa đọc → phát **một lần** mỗi phiên trình duyệt.

## Test

`dotnet test` (`OfficeHub.Modules.Chat.Tests`, `OfficeHub.Realtime.Tests/Chat*`); e2e trên DB tạm `chat-e2e.ts` + `chat-ui-e2e.ts` (Vite **:5173**) — [e2e.md](../e2e.md).

## Chưa làm

Giới hạn dung lượng tổng (việc ở bảng dự án TEST). Đã làm 2026-11-12: [chat-extras.md](chat-extras.md); dọn file của vé tải lên bỏ dở: [news-extras.md](news-extras.md#dọn-tệp-mồ-côi-cả-chat).
