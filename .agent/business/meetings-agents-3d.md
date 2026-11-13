# Họp agent trong văn phòng 3D (TEST-76)

> Nguồn sự thật là code: `OfficeHub.Realtime/Simulation/AgentMeetingWatch.cs`, `BotPresence.SyncMeetings` / `LeaveMeeting` / `MeetingBubble`, `BuildingBlocks/Office/AgentMeetingLive.cs`, Api `Modules/Meetings/…/Features/AgentMeetingLiveEndpoints.cs`, FE `features/office/components/office-view` (bảng phòng). Về [meetings-agents.md](meetings-agents.md) · bot trong 3D: [office-bots.md](office-bots.md) · đang làm / rảnh: [office-bots-work.md](office-bots-work.md).

Chủ dự án chốt 2026-11-13 (chuỗi "Họp agent" 4/5): mở phiên → bot dự họp **đi bộ** vào phòng họp (không dịch chuyển), ở đó suốt phiên, kết thúc → về chỗ theo luật hiện có.

## Luồng

```
Realtime AgentMeetingWatch ──mỗi 3 s GET /api/meetings/internal/live (X-Chat-Key = Chat__RealtimeToApiKey, trống = Chat__InternalKey)──▶ Api
   └─ BotPresence.SyncMeetings → PlayerJoined (bot chưa online) / OfficeLoop phát Positions từng bước / BotStatus (bong bóng)
```

- Api → Realtime không gọi được (Api không biết địa chỉ Realtime, không thêm biến `.env`) → **Realtime hỏi định kỳ** (`AgentMeetingLiveRoute.PollSeconds` = 3, cùng nhịp thanh trạng thái web). Độ trễ mở / đổi lượt / dừng ≤ 3 giây.
- `/api/meetings/internal/live`: `AllowAnonymous` + kiểm khoá (sai / thiếu → 401), ≤ 16 KB; nginx trả 404 từ ngoài (`location ^~ /api/meetings/internal/`). Trả phiên **Đang họp** chưa chạm trần: `{ sessionId, roomId, roomName, topic, turnsUsed, maxTurns, expiresAt, speakerUserId, bots[{ userId, name }] }` (chủ trì đầu). Request thành công không ghi log (Serilog `Verbose`; HttpClient `agent-meetings` của Realtime `RemoveAllLoggers`); Api lỗi → Realtime giữ trạng thái cũ, chỉ ghi log lần đầu.

## Bot trong phòng (`BotPresence`)

- Phiên mới → mỗi bot dự họp: chỗ như `go_to` phòng đó (ghế / beanbag trống theo băm userId → bàn trong phòng → đứng giữa phòng; không ngồi chồng bot khác / người đang ngồi), đi bộ A*, tới nơi → `ChatApi.JoinRoomAsync` (Api cũng đã thêm bot vào kênh lúc mở). Chỗ `go_to` cũ hết giữ.
- **Bot chưa online** (5 phút không gọi tool) vẫn hiện: avatar mặc định (không có `Look`, khu phòng ban chưa biết) ở **lối vào** (`spawn`) rồi đi vào. Trong phiên `LastAt` làm mới mỗi lần hỏi → không bị `BotSweeper` xoá.
- `Bot.Meeting` ≠ null → **giữ ở phòng**: `Record` không kéo về bàn / Khu nghỉ (đổi đang làm ↔ rảnh, đổi khu), `Settle` bỏ qua, `go_to` → 409 "Bot đang dự cuộc họp agent ở … — họp xong mới đi chỗ khác được".
- Phiên kết thúc (dừng / hết trần / `AllPassed`) hoặc bot không còn trong danh sách → `LeaveMeeting`: bỏ giữ, rảnh đủ `BotWork.IdleDelaySeconds` → Khu nghỉ, không thì đi bộ về bàn; bong bóng `🚶 <chỗ>`. Bot chỉ hiện vì họp → về bàn rồi offline sau 5 phút như thường.
- **Người thật của tài khoản bot đang trong văn phòng** → bỏ qua (không tạo avatar bot thứ hai, không đi), bot vẫn dự họp qua chat.
- Chỗ trong phòng chỉ trong RAM (như `go_to`); Realtime khởi động lại → lần hỏi kế cho bot đi vào lại.

## Bong bóng

| Lúc | Hiện |
|---|---|
| Đang đi vào phòng | `🚶 <tên phòng>` |
| Giữ lượt nói | `🎤 Đang phát biểu` (`BotPresence.SpeakingBubble`) — tool khác không che |
| Không giữ lượt | `👥 Đang họp · <chủ đề>` |
| Vừa nói (`send_chat_message` / `speak_in_meeting` qua MCP) | `💬 …` như cũ — vẫn giữ khi lượt chuyển đi; `🖥` / `📝` (trình chiếu) cũng giữ |

## Bảng phòng (FE)

`useActiveAgentSessions` (`GET /api/meetings/sessions?active=true`, 5 giây khi có phiên, không thì 15 giây) → `OfficeScene.setRoomStatus`: **"Đang họp với AI · chủ đề · lượt x/trần"** (nền đỏ), ưu tiên hơn lịch đặt phòng "Đang họp · …".

## Kiểm thử

`tests/OfficeHub.Realtime.Tests/BotPresenceTests.cs` (4 test họp: vào phòng kể cả offline + giữ chỗ, bong bóng theo lượt, kết thúc về bàn / Khu nghỉ, người thật dùng tài khoản bot). E2E `scripts/dev/agent-meeting-3d-e2e.ts` — 27/27 (2026-11-13).
