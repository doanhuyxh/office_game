# Bot trong văn phòng 3D

> Nguồn sự thật là code: `OfficeHub.Mcp/Infrastructure/BotPresenceReporter.cs`, `OfficeHub.Realtime/Simulation/BotPresence.cs`, `OfficeHub.Realtime/Hubs/BotEndpoints.cs`, `BuildingBlocks/Office/BotActivity.cs`. Về [README.md](README.md) · văn phòng: [office.md](office.md) · MCP: [mcp.md](mcp.md).

Tài khoản **bot** (agent AI bên ngoài làm việc qua MCP) hiện trong văn phòng 3D khi đang làm việc: ngồi ở bàn trong khu phòng ban, nhãn tím **"AI · tên"**, bong bóng "đang làm gì". Chủ dự án chốt 2026-11-10.

## Quyết định đã chốt (đừng đề xuất lại)

- **Chỉ bot**, không áp cho nhân viên thật thỉnh thoảng dùng Claude. Nhận diện bằng **cờ trên tài khoản** `identity.users.IsBot` do HR đặt (chủ dự án chọn thay cho cờ trên token). Cờ không đổi quyền gì. Bàn giao tài khoản cho người thật → HR bỏ cờ.
- **Online** = gọi tool MCP (thành công) trong **5 phút** gần nhất (`BotActivityRoute.OnlineMinutes`). MCP stateless nên không có "đang kết nối".
- **Ở đâu + làm gì**: cả hai — bàn trong khu phòng ban + dòng trạng thái = tiêu đề tool + đối tượng (`Chuyển trạng thái việc · WEB-12`; id dạng Guid bị bỏ).

## Luồng

```
Bot ──tool──▶ OfficeHub.Mcp ──(call-tool filter, chạy nền)──▶ POST /rt/internal/bot-activity (X-Internal-Key = Chat__InternalKey)
                 └─ /api/auth/me (isBot, tên, avatar) + /api/org/employees/me + /api/org/departments (MapZone) — nhớ 5 phút / token
Realtime: BotPresence (RAM) → PlayerJoined { bot: true, status } / BotStatus(id, status) / PlayerLeft ; BotSweeper 15 s xoá bot quá hạn
```

- Mcp: tool lỗi → không báo. Không phải bot → nhớ "không phải bot" 5 phút (HR bật / tắt cờ có hiệu lực sau ≤ 5 phút). Thiếu `Chat__InternalKey` → tắt. Realtime lỗi → chỉ ghi log, tool vẫn chạy. Địa chỉ Realtime: `Mcp__RealtimeBaseUrl`.
- Khu: `departments.MapZone`; phòng con chưa đặt → phòng cha gần nhất.

## Xếp bàn (`BotPresence.PickSeat`)

| Thứ tự | Bàn |
|---|---|
| 1 | `seats[]` có `zone` = khu phòng ban |
| 2 | khu làm việc chung `work` (ghế `MR-xx`) |
| 3 | bàn bất kỳ; không còn bàn → đứng ở `spawn` |

Bỏ qua bàn của bot khác và bàn có người đang ngồi (`anim` 2). Thử trước bàn theo băm FNV-1a của userId → cùng bot thường về cùng bàn. Đổi khu → gỡ avatar rồi đặt lại (`PlayerLeft` + `PlayerJoined`).

## Bot và người thật cùng tài khoản

| Tình huống | Xử lý |
|---|---|
| Người thật đang trong văn phòng | Không tạo avatar bot; `BotStatus` gắn bong bóng lên avatar người thật |
| Người thật vào khi bot đang hiện | Gửi `PlayerLeft(id)` trước `PlayerJoined` người thật |
| Người thật rời, bot còn hạn | `PlayerJoined` lại avatar bot |
| Bot hết hạn | Có người thật → `BotStatus(id, null)`; không → `PlayerLeft(id)` |

Bot không có trong `Presence` → không voice, không chat, không chiếu màn hình, không chặn `Move`.

## HR

`PUT /api/org/employees/{id}/account/bot` `{ isBot }` → 204 (HR; 404 nếu chưa có tài khoản). `AccountSummary.isBot`, `MeResponse.isBot`. FE: bảng nhân viên → menu "Đánh dấu là bot (AI)" / "Bỏ đánh dấu bot", cột Tài khoản hiện "· Bot". HUD 3D: "N người online · M AI".

## Tin nhắn của bot

Chủ dự án yêu cầu 2026-11-11 ("agent chat được trong văn phòng ảo"); phương án an toàn tự chọn (chủ dự án chưa trả lời 4 điểm, có thể đổi):

- **Chỉ tài khoản bot** (`IsBot`) nhắn được bằng token; người thật dùng token → 403 (`ChatRules.AiNotBotMessage`) — tin 1-1 của người thật không đi ra nhà cung cấp AI.
- Kênh: **Toàn văn phòng** + **1-1 người khác đã mở** với bot. Bot không tự mở 1-1 (→ hai bot không nhắn riêng được), không kênh phòng (ẩn / 404, bot không đứng trong phòng), không tệp, không thu hồi. Route token: `AccessTokenAuth.AllowedExact` (`/api/chat/(conversations|unread-count)`, `…/(office|{guid})/(messages|read)`).
- **≤ 60 tin / giờ / bot** (`ChatRules.BotMessagesPerHour`, đếm `messages.ByBot` — chỉ mục lọc `ix_messages_bot_sender_time`) → 429; vẫn giữ 1 tin / giây chung.
- `messages.ByBot` (migration `ChatByBot`) → `MessageDto.byBot`, chip **BOT** cạnh tên người gửi; `ConversationDto.peerIsBot` → tiêu đề 1-1 nhắc "tin nhắn được gửi tới trợ lý AI bên ngoài".
- Phát ngay: tool `send_chat_message` gọi Api rồi `ChatRelay` (Mcp) POST nguyên `SendResultDto` tới Realtime `/rt/internal/chat-message` (`ChatRelayRoute`, khoá `Chat__InternalKey`) → `ChatFanout` như tin gửi qua hub. Realtime chỉ nhận tin `byBot` (khoá nội bộ không thành đường giả mạo tin người thật). Lỗi → tin vẫn đã lưu (`deliveredLive: false`). Bot gọi REST thẳng (không MCP) → không phát ngay, người nhận thấy khi tải lại.
- **Bong bóng 3D**: `BotPresenceReporter.Describe` với `send_chat_message` → dòng trạng thái = `💬 <nội dung ≤ 80 ký tự>`; tin Office cũng hiện trong HUD chat.
- Bot nhận tin bằng cách **hỏi định kỳ** (`list_chats` mỗi vòng — `ServerInstructions`), chưa có webhook.
- Cảnh báo `chat_spam` (≥ 20 tin / 15 phút) → admin ([ai-monitoring.md](ai-monitoring.md)).
- E2E: `scripts/dev/bot-chat-e2e.ts` (Api + Realtime + Mcp trên DB tạm).
