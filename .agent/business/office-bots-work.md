# Bot đang làm / rảnh trong văn phòng 3D

> Nguồn sự thật là code: `BuildingBlocks/Office/BotActivity.cs` (`BotWork`, `BotPresenceReport`), `OfficeHub.Realtime/Simulation/BotPresence.cs` (`Record`, `Settle`, `RestSpot`, `Bubble`), `OfficeHub.Mcp/Infrastructure/BotPresenceReporter.cs` (`WorkAsync`, `TaskLabelAsync`, `ReportPresenceAsync`), `OfficeHub.Mcp/Program.cs` (`/mcp/presence`), `agent-runner/src/presence.ts`. Về [office-bots.md](office-bots.md) · runner: [agent-runner.md](agent-runner.md) · bong bóng chỉ nhãn thô; lệnh / diff / suy nghĩ chi tiết đi luồng riêng cho người đứng gần: [office-bots-activity.md](office-bots-activity.md).

Chủ dự án yêu cầu 2026-11-13: bot online **đang làm việc → ngồi bàn được xếp**, bong bóng trên đầu như cũ; **chưa có việc → ra chỗ nghỉ**.
Chủ dự án chốt thêm 2026-11-13: **bot đang làm một việc thì việc ở cột nào cũng tính là đang làm** — không suy từ cột (bỏ `inProgress`). Điểm còn là mặc định tự chọn: chỗ `go_to` giữ **tới khi bot đổi đang làm ↔ rảnh** (trước đây: tới lần `go_to` kế).

## Nguồn trạng thái

| Ưu tiên | Nguồn | Cách |
|---|---|---|
| 1 | **agent-runner** | `POST /mcp/presence` (host Mcp, sau `BearerGate`, token AI) `{ state: "working" \| "idle", task?, activity? }` → 204; không phải bot 403, state lạ 400, Realtime không nhận 503. Còn hiệu lực 5 phút (`BotActivityRoute.OnlineMinutes`) — trong thời gian đó trạng thái suy từ bảng việc bị bỏ qua |
| 2 | **Việc bot vừa đụng tới** (bot không chạy qua runner) | Tool MCP trên một việc (`get_task`, `update_task_status`, `update_task`, `comment_task`, `list_task_comments` — tham số `task`) → đang làm việc đó, **ở cột nào cũng vậy**; nhớ "MÃ · tên" (id → hỏi chi tiết việc; mã → tìm tên trong việc của tôi) theo token **15 phút** (`BotWork.TaskWindowMinutes`), mỗi lần đụng việc tính lại. Tool khác không đổi; hết 15 phút không đụng việc nào → rảnh. Mcp khởi động lại → quên (rảnh tới lần đụng việc kế) |


## Chỗ ngồi + đi lại (`BotPresence`)

- **Đang làm** (hoặc chưa rõ): bàn như trước (`DeskSpot`). Đang ở chỗ nghỉ / vừa hết giữ chỗ `go_to` mà có việc → **đi bộ về bàn ngay**.
- **Rảnh**: phải rảnh liên tục **60 giây** (`BotWork.IdleDelaySeconds`) mới đi — `BotSweeper` (15 giây) gọi `Settle` → thực tế 60–75 giây. Có việc lại trước đó → không đi đâu.
- **Chỗ nghỉ** (`RestSpot`): ghế / beanbag trống ở **Khu nghỉ** (`lounge`) theo băm userId → **Pantry** (`pantry`) → đứng giữa Khu nghỉ. Không ngồi chồng bot khác / người đang ngồi. Hai khu không có tường → không vào kênh chat phòng.
- **Vừa online**: đặt thẳng (không đi bộ) — rảnh → chỗ nghỉ, đang làm → bàn; chỗ `go_to` đã nhớ vẫn ưu tiên như cũ.
- **`go_to`**: giữ chỗ (`Explicit`) tới khi trạng thái đổi; đổi → bỏ giữ + quên chỗ nhớ, rồi tự về bàn / chỗ nghỉ theo luật trên.
- **Dự họp agent** (`Bot.Meeting`, TEST-76): ở phòng họp suốt phiên — luật trên không áp; hết phiên → về bàn / chỗ nghỉ ([meetings-agents-3d.md](meetings-agents-3d.md)).
- Người thật của tài khoản đang trong văn phòng → bot không tự đi (không có avatar riêng), chỉ đổi bong bóng.

## Bong bóng (`BotPresence.Bubble`)

| Trạng thái | Hiện |
|---|---|
| Đang làm, có task | `🛠 WEB-12 · <thao tác>` (thao tác runner gửi hoặc tiêu đề tool); thao tác đã có mã việc / `💬` / `🚶` → giữ nguyên |
| Rảnh | `☕ Đang nghỉ`; trừ `💬` (chat), `🚶` (đi lại), `🖥` / `📝` (trình chiếu) |
| Không rõ | tiêu đề tool như trước |

## agent-runner (`src/presence.ts`)

- Khởi động: báo `idle` + **nhịp còn sống 2 phút** (bot rảnh vẫn hiện ở Khu nghỉ thay vì biến mất sau 5 phút).
- Bắt đầu job: `working` + `MÃ · tên việc` (gửi ngay). Thao tác của agent (`onActivity`, chỉ adapter claude có) → **nhãn thô** (`activityLabel`): Đọc code / Sửa code / Chạy kiểm thử / Build / kiểm tra / Thao tác git / Chạy lệnh / Tìm trong code / Suy nghĩ / Lên kế hoạch / Cập nhật OfficeHub — **không gửi lệnh bash, đường dẫn file, lời agent** (cả công ty thấy bong bóng). Gộp tối đa 1 lần / 10 giây. Hết job (`finally`) → `idle` ngay.
- URL = `officehub.mcp_url` + `/presence`. Lỗi chỉ ghi log; 401 / 403 → ngừng báo cho agent đó (tài khoản chưa được đánh dấu bot).

## Kiểm thử

`tests/OfficeHub.Realtime.Tests/BotPresenceTests.cs` (6 test bận / rảnh), `BotPresenceReporterTests.Task_label_is_code_and_title`, `agent-runner/tests` (nhãn, gộp, 403, luồng job báo working → idle). E2E `scripts/dev/bot-presence-e2e.ts` — 24/24 (2026-11-13, sau khi bỏ suy từ cột).
