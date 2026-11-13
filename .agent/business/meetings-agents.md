# Phiên họp agent trong phòng họp (module Meetings)

> Nguồn sự thật là code: `backend/src/Modules/Meetings/` (`Domain/AgentMeeting.cs`, `Features/AgentMeetingEndpoints.cs`, `Infrastructure/AgentMeetingExpiryJob.cs`, `Infrastructure/AgentMeetingTurnService.cs`, hợp đồng `OfficeHub.Modules.Meetings.Contracts`). Về [README.md](README.md) · đặt phòng: [meetings.md](meetings.md) · bot trong 3D: [office-bots.md](office-bots.md).

Chủ dự án chốt 2026-11-13 (chuỗi TEST-74..78 "Họp agent"): nhiều agent nghiệp vụ trao đổi với nhau **trong phiên họp** ở phòng họp. Ngoài phiên họp giữ luật cũ: bot không trả lời bot.
TEST-74 làm phần nền (bảng, API mở / dừng / xem, trần, job hết giờ). TEST-75 chia lượt nói (mục [Lượt nói](#lượt-nói-test-75)); TEST-82 tool MCP ([meetings-agents-mcp.md](meetings-agents-mcp.md)), 3D 4/5, giao diện TEST-83 ([meetings-agents-ui.md](meetings-agents-ui.md): nút "Họp với AI", thanh trạng thái, thẻ cấu hình, `GET /agent-bots`, tin hệ thống mở họp, người mở vào kênh phòng).

- **Chỉ người thật mở và dừng.** Token AI (người hay bot) gọi mở / dừng → 403 (route ngoài allowlist `AccessTokenAuth`, endpoint còn tự kiểm `IsAccessToken()`); tài khoản bot đăng nhập web cũng 403 khi mở. Người mở cần hồ sơ nhân viên (409 nếu không).
- **Dừng**: người mở hoặc HR / admin (`IsHr`). Phiên đã kết thúc → 409.
- **Mỗi phòng tối đa một phiên Đang họp**: `pg_advisory_xact_lock(hashtext('meetings:agent:' + roomId))` rồi kiểm tra → 409 kèm chủ đề + người mở; chốt chặn cuối là index unique một phần `ux_agent_sessions_room_active`. Phiên trong phòng đã quá trần mà job chưa đóng → đóng luôn (`TimeLimit`) rồi mở phiên mới.
- **Bot dự** (`AgentMeetingRules.ValidateOpen`, test `tests/OfficeHub.Modules.Meetings.Tests/AgentMeetingRulesTests.cs`): 2 ≤ số bot ≤ 8 (bỏ trùng); mỗi bot là nhân viên còn làm, có tài khoản đang hoạt động gắn cờ `IsBot` (tra qua `Organization.Contracts.IEmployeeDirectory` + `Identity.Contracts.IAccountService`, không JOIN chéo schema); bot chủ trì nằm trong danh sách; chủ đề bắt buộc, ≤ 300 ký tự; phòng = `rooms[kind = meeting]`.
- **Trần**: mặc định **30 lượt phát biểu (lượt của bot chủ trì cũng tính) hoặc 30 phút**. Admin chỉnh (2..200 lượt, 5..240 phút); **chụp lại vào phiên lúc mở** — đổi cài đặt không ảnh hưởng phiên đang họp. `AgentMeetingRules.LimitReached`: lượt trước, rồi thời gian.
- **Job** `AgentMeetingExpiryJob` (`meetings.agent-expiry`, mỗi phút, trang Hệ thống → Vận hành): kết thúc phiên quá trần (`TimeLimit`, không ghi người dừng); bot giữ lượt quá 3 phút → coi như bỏ lượt.
- **Lý do kết thúc**: `Stopped` (người dừng, ghi `EndedByName`) · `TurnLimit` · `TimeLimit` · `AllPassed` (chủ trì bỏ lượt, không ai chờ — "không còn ai phát biểu"). Mọi lần kết thúc → **tin hệ thống** trong kênh phòng (người gửi `OfficeHub`, `SenderId` rỗng; chỉ lưu DB, chưa phát realtime — người đang mở kênh thấy khi tải lại / `read_chat`).

## Endpoint (`/api/meetings`, đăng nhập)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/sessions?roomId=&active=true` | Mới nhất trước, ≤ 50. Người thật (cookie) thấy mọi phiên; **token AI chỉ thấy phiên mình là bot dự** |
| GET | `/sessions/{id}` | Như trên; không dự → 404 |
| POST | `/sessions` | `{ roomId, topic, chairEmployeeId, botIds }` → phiên (`status`, `bots[]` chủ trì đầu, `maxTurns`, `maxMinutes`, `expiresAt`, `canStop`). Người thật, cookie |
| POST | `/sessions/{id}/stop` | Người mở / HR / admin, cookie |
| GET / PUT | `/agent-settings` | `{ maxTurns, maxMinutes }` + mặc định / khoảng cho phép, `isDefault`. **Chỉ `AuthPolicies.Admin`**, ngoài allowlist token AI; `[Audited]` |

| GET | `/sessions/mine` | **TEST-82** — phiên Đang họp tài khoản bot gọi đang dự: `{ session, conversationId, isChair, attendees[] }` (attendee: mã, tên, phòng ban, chức vụ, `isSpeaking`, `queuePosition`); không dự → `session = null`. Không phải tài khoản bot → 403 |
| POST | `/sessions/{id}/pass` | **Bot dự họp đang giữ lượt** bỏ lượt (token AI được — allowlist). Không giữ lượt / phiên đã kết thúc → 409; không dự → 404 |
| POST | `/sessions/{id}/assign` | `{ employeeId }` — **bot chủ trì đang giữ lượt** chỉ định bot dự họp khác nói kế. Tự chỉ định / bot ngoài họp / không phải chủ trì / không giữ lượt → 409 |

`pass` / `assign` / `mine`: tài khoản không phải bot (token AI của người thật hay cookie) → **403** trước mọi kiểm tra khác.
DTO phiên có thêm `currentSpeakerEmployeeId`, `turnDeadline` (quá giờ này chưa nói = bỏ lượt), `isMyTurn` (người gọi đang giữ lượt); `bots[]` có `isSpeaking`, `queuePosition` (1 = kế tiếp).
Enum trả dạng chữ (`Active` / `Ended`, `Stopped` …). Allowlist token AI cho Meetings giờ liệt kê từng nhánh GET (`/rooms`, `/bookings`, `/sessions`) thay cho cả tiền tố `/api/meetings` — để `/agent-settings` không lọt.

E2E: `scripts/dev/agent-meeting-e2e.ts` ([../e2e.md](../e2e.md)).

## Lượt nói (TEST-75)

Chủ dự án chốt 2026-11-13: **bot chủ trì chỉ định** người nói, bot **được @nhắc** trong tin vừa nói thì nói tiếp. Quy tắc thuần `AgentMeetingTurnRules` (test `AgentMeetingTurnRulesTests.cs`); mọi lần đổi lượt chạy dưới khoá theo phòng (`AgentMeetingTurnService.ApplyAsync`, cùng khoá lúc mở). Cột `CurrentSpeakerEmployeeId`, `TurnStartedAt`, `QueuedSpeakerIds` (uuid[]).

- Mở họp → lượt đầu thuộc **bot chủ trì**; bot dự họp được thêm vào kênh phòng (đọc / nhắn / được @nhắc như khi đi vào phòng).
- **Mỗi lượt một tin**. Bot giữ lượt nói → tính 1 lượt; @mã bot dự họp → các bot đó lần lượt theo thứ tự nhắc (xếp **trước** hàng chờ cũ); không nhắc ai → bot kế trong hàng chờ, hết hàng → về chủ trì.
- **Bỏ lượt** (API) / **hết giờ chờ 3 phút** (job) → tính 1 lượt, sang bot kế / chủ trì; **chủ trì bỏ lượt khi không ai chờ → kết thúc `AllPassed`**. Chủ trì **chỉ định** (API) → tính 1 lượt. Tính cả bỏ / chỉ định / hết giờ để vòng "chỉ định ↔ bỏ lượt" cũng chạm trần.
- **Người thật** trong phòng nhắn bất kỳ lúc nào, không tính lượt; @nhắc bot dự họp → bot nhắc đầu tiên nhận lượt **ngay**, bot nhắc sau rồi bot vừa bị ngắt xếp đầu hàng chờ.
- **Chặn ở back-end** (`ChatEndpoints` qua `IAgentMeetingTurns`, không tham chiếu project Meetings): phòng đang họp → bot dự họp không giữ lượt gửi tin → **409** "Chưa tới lượt… đang là lượt của X"; bot không dự họp (token hoặc tài khoản bot trên web) → 409; tài khoản bot sửa tin trong kênh phòng → 409. Hạn mức 60 tin / giờ / bot, chặn 1 tin / giây và cảnh báo `chat_spam` giữ nguyên.
- **Đánh thức** chỉ bot vừa nhận lượt: Telegram `event: meeting_turn` ([notifications-telegram.md](notifications-telegram.md)) + webhook `meeting.turn` (`sessionId`, `conversationId`, `roomId`, `roomName`, `topic`, `isChair`, `turnsUsed`, `maxTurns`, `turnDeadline`, `expiresAt`, `link`). Đây là trường hợp **duy nhất** tin của bot đánh thức bot khác; bot nhận `meeting_turn` không nhận thêm `chat_mention` trùng. Ngoài phiên họp: bot nhắc bot vẫn không đánh thức.
- Chiều phụ thuộc: Chat → `Meetings.Contracts.IAgentMeetingTurns` (Meetings cài); Meetings → `IMeetingRoomChannel` (Chat cài: id kênh phòng, thêm thành viên, tin hệ thống) — cùng project Contracts, không vòng tham chiếu.

E2E: `scripts/dev/agent-meeting-turns-e2e.ts` (Telegram + webhook giả) — 50/50 (2026-11-13).

