# Phiên họp agent trong phòng họp (module Meetings)

> Nguồn sự thật là code: `backend/src/Modules/Meetings/` (`Domain/AgentMeeting.cs`, `Features/AgentMeetingEndpoints.cs`, `Infrastructure/AgentMeetingExpiryJob.cs`). Về [README.md](README.md) · đặt phòng: [meetings.md](meetings.md) · bot trong 3D: [office-bots.md](office-bots.md).

Chủ dự án chốt 2026-11-13 (chuỗi TEST-74..78 "Họp agent"): nhiều agent nghiệp vụ trao đổi với nhau **trong phiên họp** ở phòng họp. Ngoài phiên họp giữ luật cũ: bot không trả lời bot.
TEST-74 làm phần nền (bảng, API mở / dừng / xem, trần, job hết giờ). Chia lượt nói (tăng `TurnsUsed`, `AllPassed`) ở TEST-75, tool MCP 3/5, 3D 4/5, giao diện 5/5.

- **Chỉ người thật mở và dừng.** Token AI (người hay bot) gọi mở / dừng → 403 (route ngoài allowlist `AccessTokenAuth`, endpoint còn tự kiểm `IsAccessToken()`); tài khoản bot đăng nhập web cũng 403 khi mở. Người mở cần hồ sơ nhân viên (409 nếu không).
- **Dừng**: người mở hoặc HR / admin (`IsHr`). Phiên đã kết thúc → 409.
- **Mỗi phòng tối đa một phiên Đang họp**: `pg_advisory_xact_lock(hashtext('meetings:agent:' + roomId))` rồi kiểm tra → 409 kèm chủ đề + người mở; chốt chặn cuối là index unique một phần `ux_agent_sessions_room_active`. Phiên trong phòng đã quá trần mà job chưa đóng → đóng luôn (`TimeLimit`) rồi mở phiên mới.
- **Bot dự** (`AgentMeetingRules.ValidateOpen`, test `tests/OfficeHub.Modules.Meetings.Tests/AgentMeetingRulesTests.cs`): 2 ≤ số bot ≤ 8 (bỏ trùng); mỗi bot là nhân viên còn làm, có tài khoản đang hoạt động gắn cờ `IsBot` (tra qua `Organization.Contracts.IEmployeeDirectory` + `Identity.Contracts.IAccountService`, không JOIN chéo schema); bot chủ trì nằm trong danh sách; chủ đề bắt buộc, ≤ 300 ký tự; phòng = `rooms[kind = meeting]`.
- **Trần**: mặc định **30 lượt phát biểu (lượt của bot chủ trì cũng tính) hoặc 30 phút**. Admin chỉnh (2..200 lượt, 5..240 phút); **chụp lại vào phiên lúc mở** — đổi cài đặt không ảnh hưởng phiên đang họp. `AgentMeetingRules.LimitReached`: lượt trước, rồi thời gian.
- **Job** `AgentMeetingExpiryJob` (`meetings.agent-expiry`, mỗi phút, trang Hệ thống → Vận hành): kết thúc phiên quá trần (`TimeLimit`, không ghi người dừng).
- **Lý do kết thúc**: `Stopped` (người dừng, ghi `EndedByName`) · `TurnLimit` · `TimeLimit` · `AllPassed` (mọi bot bỏ lượt — TEST-75).

## Endpoint (`/api/meetings`, đăng nhập)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/sessions?roomId=&active=true` | Mới nhất trước, ≤ 50. Người thật (cookie) thấy mọi phiên; **token AI chỉ thấy phiên mình là bot dự** |
| GET | `/sessions/{id}` | Như trên; không dự → 404 |
| POST | `/sessions` | `{ roomId, topic, chairEmployeeId, botIds }` → phiên (`status`, `bots[]` chủ trì đầu, `maxTurns`, `maxMinutes`, `expiresAt`, `canStop`). Người thật, cookie |
| POST | `/sessions/{id}/stop` | Người mở / HR / admin, cookie |
| GET / PUT | `/agent-settings` | `{ maxTurns, maxMinutes }` + mặc định / khoảng cho phép, `isDefault`. **Chỉ `AuthPolicies.Admin`**, ngoài allowlist token AI; `[Audited]` |

Enum trả dạng chữ (`Active` / `Ended`, `Stopped` …). Allowlist token AI cho Meetings giờ liệt kê từng nhánh GET (`/rooms`, `/bookings`, `/sessions`) thay cho cả tiền tố `/api/meetings` — để `/agent-settings` không lọt.

E2E: `scripts/dev/agent-meeting-e2e.ts` ([../e2e.md](../e2e.md)).
