# Bot cần chú ý trong văn phòng 3D (lỗi / chờ người)

> Nguồn sự thật là code: `BuildingBlocks/Office/BotAttention.cs` (`BotWaitingRoute`, `BotWaiting`), `BotActivity.cs` (`BotError`, `BotActivity.Error`), `OfficeHub.Realtime/Simulation/BotPresence.cs` (`Bot.Error` / `Waiting` / `NeedsAttention`, `SyncWaiting`, `AttentionBubble`), `Simulation/BotWaitingWatch.cs`, `Hubs/OfficeRoomHub.cs` (`BotAlertDto`, `AlertOf`, `IOfficeClient.BotAlert`), `Hubs/BotEndpoints.cs`. Về [office-bots-work.md](office-bots-work.md) (đang làm / rảnh).

## Hợp đồng (TEST-117)

Chủ dự án chốt 2026-11-16, các việc nối tiếp (Mcp, Projects, Realtime, FE, runner) dùng chung `BuildingBlocks/Office`:
- **Lỗi**: `BotWork.Error = "error"`, `BotPresenceReport` thêm `Error` / `TaskId` / `ProjectId` (null mặc định); `BotActivity.Error` (`BotError(Text, Task, TaskId, ProjectId)`, chỉ khi `FromRunner`, null = hết lỗi). Bong bóng chỉ loại lỗi ngắn ≤ `BotWork.MaxError` (40); lỗi giữ tới khi runner báo trạng thái khác.
- **Chờ người** (`BotAttention.cs`): Realtime POST `BotWaitingRoute.Path` (`/api/projects/internal/bot-waiting`, khoá `X-Chat-Key` như `/api/meetings/internal/live`) mỗi 30 giây, ≤ 200 bot, ≤ 10 việc / bot; `Kind` = `approval` | `reply`. Nhận biết theo thao tác cuối trên việc là của chính bot, chưa có người thật thao tác lại — không dựa vào cột.
  - **Api (TEST-119)**: `Projects/Features/BotWaitingEndpoints.cs` (`AllowAnonymous` + kiểm khoá, sai / thiếu → 401; > 200 userId → 400; ≤ 16 KB; nginx 404 từ ngoài `location ^~ /api/projects/internal/`). userId → nhân viên đang làm (`IEmployeeDirectory.ListActiveAsync`); việc giao cho họ, chưa xong, dự án `Active`, không còn việc phụ thuộc chưa xong. Chỉ trả bot có việc chờ, việc mới nhất trước.
  - **Luật** (`Domain/BotWaitRules.cs`, hàm thuần + test): lịch sử + bình luận duyệt mới → cũ; người thật (kể cả sửa nội dung / đổi hạn / xoá bình luận) → không chờ; sự kiện bot không tính (`Created` / `Edited` / `DueChanged` / `Depends` / `CommentDeleted`) → bỏ qua; sự kiện bot có tính (`Moved` / `Assigned` / bình luận) → chờ từ lúc đó nếu do chính người làm việc, bot khác → không chờ. `approval` khi cột ngay sau cột hiện tại là cột cần duyệt, còn lại `reply`.

## Realtime (TEST-120) — giữ trong RAM, không migration

- **Lỗi**: `Record` — báo của runner (`FromRunner`) gán `Bot.Error = a.Error` (null = hết lỗi); báo của Mcp (bot gọi tool) không đụng tới lỗi.
- **Chờ người**: `BotWaitingWatch` (mẫu `AgentMeetingWatch`) mỗi 30 giây, có bot online → POST `BotWaitingRoute.Path` kèm userId các bot (≤ 200) → `SyncWaiting(list, asked)`: gán `Bot.Waiting`; bot đang làm (`Busy == true`) bỏ việc trùng mã với việc đang làm; bot đã hỏi mà không có trong kết quả → `[]`; bot không nằm trong lần hỏi giữ nguyên. Api lỗi → giữ nguyên, chỉ log lần đầu. Không đổi → không phát.
- `Bot.NeedsAttention = Error != null || Waiting.Count > 0`:
  - Không ra Khu nghỉ (`GoRestIfIdle` / `Settle` bỏ qua); vừa online mà rảnh + cần chú ý → đặt ở bàn.
  - Đang ở chỗ nghỉ (kể cả đang đi ra) mà vừa cần chú ý → **đi bộ về bàn** — trừ bot đang giữ chỗ `go_to` (`Explicit`), đang dự họp agent, hoặc người thật cùng tài khoản đang trong văn phòng.
  - Hết cần chú ý mà vẫn rảnh ≥ 60 giây → ra Khu nghỉ như cũ (`Record` / `Settle`).
- **Bong bóng** (`Bubble`, chỉ khi rảnh — đang làm / dự họp như cũ), sau `💬` / `🚶` / `🖥` / `📝`: lỗi → `⚠ WEB-12 · Hết giờ` (không gắn việc → `⚠ Hết giờ`); 1 việc chờ → `⏳ WEB-12 · Chờ duyệt` / `⏳ WEB-12 · Chờ phản hồi`; nhiều việc → `⏳ N việc chờ duyệt` (tất cả `approval`) / `⏳ N việc chờ người`; còn lại `☕ Đang nghỉ`.
- **Hub** (`OfficeRoomHub`): `BotAlertDto(Kind "error" | "waiting", Text = như bong bóng ⚠ / ⏳, Items)`, `BotAlertItemDto(Kind "error" | "approval" | "reply", Code, Title, Link = /projects/{projectId}?task={taskId} | null)`; có lỗi → `Kind = "error"`, mục lỗi đứng đầu rồi các việc chờ. `PlayerDto.Alert` (null = không) điền cho avatar bot và avatar người thật cùng tài khoản. `IOfficeClient.BotAlert(id, alert | null)` phát khi: `/rt/internal/bot-activity` làm đổi lỗi (avatar vừa đặt lại thì `PlayerJoined` đã kèm), `BotWaitingWatch` thấy bot đổi việc chờ (kèm `BotStatus`), `BotSweeper` gỡ bot quá hạn khi người thật cùng tài khoản đang trong văn phòng (`null`). FE hiển thị: TEST-122.
- Test: `tests/OfficeHub.Realtime.Tests/BotPresenceTests.cs` (5 test TEST-120: lỗi ở bàn + ⚠ + runner báo working hết lỗi; lỗi khi đang nghỉ → về bàn, idle → Khu nghỉ; việc chờ kéo về bàn, hết chờ + 60 s → Khu nghỉ, ⏳ 1 / N việc; việc đang làm không tính chờ; bot dự họp / giữ chỗ go_to / người thật cùng tài khoản không bị kéo).
