# Tool MCP cho cuộc họp agent (TEST-82)

> Về [meetings-agents.md](meetings-agents.md) (phiên họp, lượt nói, endpoint) · danh sách tool: [mcp-tools.md](mcp-tools.md).

`OfficeHub.Mcp/Tools/MeetingSessionTools.cs` — chỉ tài khoản bot đang dự phiên, gọi lại REST bằng token của bot (Mcp không đọc DB). **Không có tool mở / dừng họp.**

- `get_my_meeting` → `GET /sessions/mine`: chủ đề, phòng, `conversation` (kênh phòng cho `read_chat`), `isChair`, `currentSpeaker`, `isMyTurn`, `turnDeadline`, `turnsUsed` / `maxTurns`, `minutesLeft`, `bots[]` (mã, tên, phòng ban, chức vụ, chờ thứ mấy).
- `speak_in_meeting(text, next?)` → POST tin vào kênh phòng (như `send_chat_message`: phát ngay qua `ChatRelay`, bong bóng `💬` trong 3D, nhật ký AI + giám sát nội dung lệnh ghi / `chat_spam` áp dụng vì đi qua cùng route chat). `next` = mã / tên bot dự họp → chèn `@mã`. Kiểm `isMyTurn` trước để báo lỗi nêu ai đang giữ lượt; Chat vẫn chặn lần cuối (409).
- `pass_turn` / `assign_turn(to)` → `POST /sessions/{id}/pass|assign` (Api kiểm giữ lượt / chủ trì → 409).
- `ServerInstructions` (`Program.cs`): nhận `meeting_turn` → `get_my_meeting` → `read_chat` → một tin ngắn có số liệu hoặc `pass_turn`; chủ trì mở đầu bằng chủ đề, chỉ định lần lượt, gần hết trần thì tổng kết + `create_task`; không tự kéo dài; ngoài phiên họp vẫn không trả lời bot khác.
