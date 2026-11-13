# Bot đang làm / rảnh trong văn phòng 3D

> Nguồn sự thật là code: `BuildingBlocks/Office/BotActivity.cs` (`BotWork`, `BotPresenceReport`), `OfficeHub.Realtime/Simulation/BotPresence.cs` (`Record`, `Settle`, `RestSpot`, `Bubble`), `OfficeHub.Mcp/Infrastructure/BotPresenceReporter.cs` (`WorkAsync`, `ReportPresenceAsync`), `OfficeHub.Mcp/Program.cs` (`/mcp/presence`), `agent-runner/src/presence.ts`. Về [office-bots.md](office-bots.md) · runner: [agent-runner.md](agent-runner.md).

Chủ dự án yêu cầu 2026-11-13: bot online **đang làm việc → ngồi bàn được xếp**, bong bóng trên đầu như cũ; **chưa có việc → ra chỗ nghỉ**.
Hai điểm chưa được trả lời, đang dùng mặc định tự chọn (có thể đổi): cột chờ duyệt tính là **rảnh**; chỗ `go_to` giữ **tới khi bot đổi đang làm ↔ rảnh** (trước đây: tới lần `go_to` kế).

## Nguồn trạng thái

| Ưu tiên | Nguồn | Cách |
|---|---|---|
| 1 | **agent-runner** | `POST /mcp/presence` (host Mcp, sau `BearerGate`, token AI) `{ state: "working" \| "idle", task?, activity? }` → 204; không phải bot 403, state lạ 400, Realtime không nhận 503. Còn hiệu lực 5 phút (`BotActivityRoute.OnlineMinutes`) — trong thời gian đó trạng thái suy từ bảng việc bị bỏ qua |
| 2 | **Bảng việc** (bot không chạy qua runner) | Mỗi tool MCP: Mcp gọi `/api/projects/tasks/mine` bằng token của bot (nhớ 30 giây / token; `update_task_status` / `create_task` / `update_task` hỏi lại ngay) → có việc `inProgress` → đang làm, task = "MÃ · tên" của việc đầu tiên. Api lỗi → không rõ (giữ trạng thái cũ) |

`TaskDto.inProgress` (`TaskColumnRules.IsInProgress`): không ở cột đầu (position 0), không ở cột hoàn thành / cần duyệt, không còn việc phải chờ (`waitingOn`), và tên cột (bỏ dấu) không có `review` / `duyet` / `nghiem thu`, không bắt đầu bằng `cho ` — cột chờ (vd "Chờ review") = phần người làm đã xong → **rảnh**.

## Chỗ ngồi + đi lại (`BotPresence`)

- **Đang làm** (hoặc chưa rõ): bàn như trước (`DeskSpot`). Đang ở chỗ nghỉ / vừa hết giữ chỗ `go_to` mà có việc → **đi bộ về bàn ngay**.
- **Rảnh**: phải rảnh liên tục **60 giây** (`BotWork.IdleDelaySeconds`) mới đi — `BotSweeper` (15 giây) gọi `Settle` → thực tế 60–75 giây. Có việc lại trước đó → không đi đâu.
- **Chỗ nghỉ** (`RestSpot`): ghế / beanbag trống ở **Khu nghỉ** (`lounge`) theo băm userId → **Pantry** (`pantry`) → đứng giữa Khu nghỉ. Không ngồi chồng bot khác / người đang ngồi. Hai khu không có tường → không vào kênh chat phòng.
- **Vừa online**: đặt thẳng (không đi bộ) — rảnh → chỗ nghỉ, đang làm → bàn; chỗ `go_to` đã nhớ vẫn ưu tiên như cũ.
- **`go_to`**: giữ chỗ (`Explicit`) tới khi trạng thái đổi; đổi → bỏ giữ + quên chỗ nhớ, rồi tự về bàn / chỗ nghỉ theo luật trên.
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

`tests/OfficeHub.Realtime.Tests/BotPresenceTests.cs` (6 test bận / rảnh), `TaskColumnRulesTests.In_progress`, `BotPresenceReporterTests.Busy_from_task_board…`, `agent-runner/tests` (nhãn, gộp, 403, luồng job báo working → idle). E2E `scripts/dev/bot-presence-e2e.ts` — 26/26 (2026-11-13).
