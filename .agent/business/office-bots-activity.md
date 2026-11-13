# Luồng hoạt động bot — "xem trực tiếp agent đang làm gì"

> Phần tiếp của [office-bots.md](office-bots.md) / [office-bots-work.md](office-bots-work.md). Code: `BuildingBlocks/Office/BotActivityFeed.cs` (hợp đồng), `OfficeHub.Realtime/Simulation/BotActivityFeed.cs` (đệm RAM), `Hubs/BotActivityFeedEndpoints.cs`, dọn trong `BotSweeper` (`Hubs/BotEndpoints.cs`); hub xem trực tiếp: `Simulation/BotWatch.cs` + `WatchBot` / `UnwatchBot` trong `Hubs/OfficeRoomHub.cs`; cửa vào Mcp: `OfficeHub.Mcp/Program.cs` (`/mcp/activity`), `Infrastructure/BotActivityGate.cs`, `BotPresenceReporter.ReportActivityAsync`; bot không qua runner: `Infrastructure/BotToolFeed.cs`. Test: `tests/OfficeHub.Realtime.Tests/BotActivityFeedTests.cs`, `BotWatchTests.cs`, `tests/OfficeHub.Mcp.Tests/BotActivityGateTests.cs`, `BotToolFeedTests.cs`.

Chủ dự án duyệt 2026-11-14: bấm vào bot trong 3D → bảng giống chia sẻ màn hình: lệnh đang chạy, file đang sửa (diff), suy nghĩ, lời agent theo thời gian thực. Đã chốt: luồng **có cấu trúc** (không ảnh / video); **không lưu lịch sử** (chỉ RAM, không DB / S3); **có hiện suy nghĩ**; bong bóng trên đầu bot **giữ nhãn thô** như cũ (`/mcp/presence`, không đưa lệnh / đường dẫn lên bong bóng).

TEST-92 (nền móng) = hợp đồng + đệm Realtime + endpoint nội bộ + điểm móc. TEST-94 = cửa vào Mcp `/mcp/activity`. TEST-95 = hub xem trực tiếp (`WatchBot`). TEST-96 = bot không qua runner tự phát sự kiện `tool`. TEST-97 = FE chọn bot + kết nối (mục [FE](#fe-bấm-vào-bot-để-xem-test-97)); TEST-98 = bảng hiển thị đầy đủ. agent-runner (TEST-93 tách sự kiện, TEST-99 gửi theo lô): [agent-runner-activity.md](agent-runner-activity.md).

## Nguồn sự kiện: runner / tool MCP (TEST-96)

- **Agent chạy qua agent-runner**: runner dựng sự kiện có cấu trúc (lệnh, diff, suy nghĩ…) từ stream của CLI agent và gửi lô qua `POST /mcp/activity` — nguồn chính, chi tiết nhất.
- **Bot kết nối MCP trực tiếp (không qua runner)**: host Mcp tự phát (`BotToolFeed` + móc trong `BotPresenceReporter.Report`, chạy nền — lỗi chỉ ghi log, không làm hỏng lời gọi tool):
  - Mỗi lần tài khoản bot gọi tool → sự kiện `kind: "tool"`: `title` = tiêu đề tiếng Việt của tool (thuộc tính Title, như bong bóng), `text` = tên tool + mã việc nếu tham số có `task` (`TaskCodeOf`; tham số là id → suy mã từ nhãn BotWork đã biết), `ok` = tool thành công / lỗi. **Không** gửi tham số khác / kết quả tool (có thể chứa dữ liệu nhân sự / tài chính). Người thường gọi tool → không phát (không phải bot).
  - Lần gọi tool đầu sau khi rảnh → tự phát `session_start` (`task` = việc đang đụng theo `BotWork`, nếu có); quá `BotWork.TaskWindowMinutes` (15) phút không gọi tool → `session_end` (sweeper `BotToolFeedSweeper`, quét mỗi phút).
  - **Tránh trùng với runner**: bot có presence runner còn hiệu lực (`/mcp/presence`, 5 phút = `BotActivityRoute.OnlineMinutes`) hoặc vừa gửi `/mcp/activity` trong 5 phút → không tự phát; phiên tự mở bị quên luôn (không `session_end` — đệm giờ là của runner).

## Hợp đồng `BotActivityEvent`

| Trường | Giới hạn | Ghi chú |
|---|---|---|
| `id` | ≤ 64, bắt buộc | Bên gửi đặt. Gửi lại cùng `id` = **cập nhật** sự kiện cũ (trường null giữ giá trị cũ; giữ `seq` + `at` gốc) — dùng cho kết quả lệnh về sau |
| `kind` | bắt buộc | `session_start` · `session_end` · `command` · `file_edit` · `file_write` · `file_read` · `search` · `thinking` · `say` · `tool` (phân biệt hoa thường). Lạ → 400 |
| `title` | ≤ 200, một dòng | "Chạy lệnh", "Sửa src/a.ts" |
| `text` | ≤ 4 000 | Lệnh bash / suy nghĩ / lời agent / truy vấn tìm kiếm |
| `path` | ≤ 400, một dòng | Tương đối so với repo |
| `diff` | ≤ 200 dòng rồi ≤ 16 000 ký tự | Unified (`-` / `+`) |
| `output` | ≤ 4 000 | Cắt giữ **phần cuối** (`…` ở đầu) |
| `ok` | bool? | Lệnh / tool thành công hay lỗi |
| `task`, `model`, `turns`, `costUsd` | 200 / 100 / ≥ 0 / ≥ 0 | Cho `session_start` / `session_end` (`task` = "MÃ · tên việc") |
| `seq`, `at` | server gán | `seq` tăng dần theo bot (qua các phiên, mất khi Realtime khởi động lại); `at` = `TimeProvider`. Giá trị bên gửi bị bỏ |

Làm sạch (`BotActivityFeed.Clean`): quá độ dài → **cắt** (thêm `…`), không từ chối; bỏ ký tự điều khiển (trường nhiều dòng giữ `\n` / `\t`, bỏ `\r`; trường một dòng đổi xuống dòng / tab thành dấu cách); rỗng / toàn khoảng trắng → null.

## Endpoint nội bộ

`POST /rt/internal/bot-activity-feed` — body `BotActivityBatch { userId, events[] }`, khoá `X-Internal-Key` = `Chat__McpToRealtimeKey` (trống → `Chat__InternalKey`), như `/rt/internal/bot-screen`. **Không dùng `/rt/internal/bot-activity`** như mô tả việc ban đầu: đường đó đã là báo presence (`BotActivityRoute.Path`, body `BotActivity`).

- Sai / thiếu khoá → 401 (`InternalRouteGuard` chặn trước khi đọc body, handler kiểm lại). Body ≤ 2 MB (`ActivityFeedMaxBody`; các đường nội bộ khác 64 KB).
- Thiếu `userId` / `events` rỗng / > 50 sự kiện / `kind` lạ / thiếu `id` → 400 `events[i]: lý do`, **cả lô không ghi gì**.
- OK → `{ accepted, lastSeq }`.
- Realtime không kiểm cờ bot (không có dữ liệu tài khoản) — bên gửi (Mcp) phải xác thực token của bot và chỉ gửi cho chính bot đó.

## Cửa vào Mcp `POST /mcp/activity` (TEST-94)

Cho agent-runner / bên ngoài gửi sự kiện bằng **token AI của bot** (host `OfficeHub.Mcp`, sau `BearerGate` — như `/mcp/presence`). Body `{ events: BotActivityEvent[] }` (`BotActivityFeedReport` — KHÔNG có `userId`: Mcp xác thực token, lấy `userId` của chính bot rồi chuyển nguyên lô sang `/rt/internal/bot-activity-feed`; Mcp không lưu sự kiện, không ghi nội dung vào log / nhật ký AI — chỉ đếm).

- Không token → 401 (`BearerGate`); token người thường (không phải bot) → 403.
- Quá `McpMaxCallsPerSecond` (5) lần / giây cho một token → 429 (cửa sổ cố định theo giây, `BotActivityGate.Allow`).
- Thân > `McpMaxBodyBytes` (256 KB) / JSON hỏng / thiếu `events` / > 50 sự kiện / `kind` lạ / thiếu `id` → 400, cả lô không gửi gì (`BotActivityGate.Validate` — cùng luật với `BotActivityFeed.Clean`).
- Realtime không nhận (khoá trống, lỗi mạng, non-2xx) → 503; OK → **204**.
- nginx container web: `location = /mcp/activity` (`client_max_body_size 256k`) trong `frontend/nginx.conf` — proxy VPS ngoài không cần đổi (chỉ proxy domain → cổng 7080).

## Vòng đời đệm (`BotActivityFeed`, singleton, thread-safe — khoá theo bot)

- Mỗi bot một vòng đệm **200 sự kiện gần nhất của phiên hiện tại** (tràn → bỏ cũ nhất).
- `session_start` → xoá đệm cũ rồi ghi sự kiện. `session_end` → phát cho người nghe (có `seq`) rồi xoá đệm, không giữ.
- `BotSweeper` (15 s): bot offline (`BotPresence.Expire`, 5 phút không gọi tool) → `Clear`; đệm không có sự kiện mới quá 5 phút (`BotActivityFeed.Idle`) → xoá.
- `Snapshot(userId)` — bản sao đệm cho người mới mở bảng.

## Điểm móc cho hub xem

- `event Appended(userId, BotActivityEvent)` — sự kiện mới / cập nhật (cập nhật giữ `seq` → client thay theo `id`), gồm cả `session_end`. Gọi **trong khoá của bot** để giữ đúng thứ tự `seq`: người nghe chỉ được xếp hàng gửi (không `await`, không chặn). `BotWatch` nghe cả hai móc theo đúng luật này.
- `event Cleared(userId)` — đệm bị xoá do offline / rảnh (chỉ phát khi đệm còn sự kiện).

## Hub xem trực tiếp (TEST-95 — `Simulation/BotWatch.cs`, hub `/rt/hub/office`)

Chủ dự án chốt 2026-11-14: văn phòng là không gian mở nên **ai bấm vào bot cũng xem được**, nhưng phải **đứng trong phạm vi nghe được** — kiểm ở back-end, không tin client.

**Phạm vi nghe được** (`OfficeMap.CanHear`, dùng lại luật voice): người xem và bot **cùng kênh voice** (`OfficeMap.VoiceAt`); phòng `voice: "room"` (họp / gọi) → cả phòng; còn lại (khu mở, phòng có tường khác) → cách nhau ≤ `OfficeMap.HearRange` = **6 m** (hằng số dùng chung, PHẢI khớp `VOICE_FAR` ở FE `engine/voiceChannel.ts`).

- `WatchBot(botUserId)` (client → server): người gọi phải đang trong hub; bot phải đang hiện trong 3D (người thật của tài khoản đang trong văn phòng → không xem được); ngoài phạm vi → `HubException("Hãy lại gần hơn để xem")`. Trả `BotWatchDto { botId, name, busy, task, events[] }` = đệm phiên hiện tại (≤ 200). Mỗi kết nối xem **một** bot — gọi `WatchBot` khác = đổi.
- `UnwatchBot()` — thôi xem; ngắt kết nối cũng tự thôi.
- Server → client `BotActivity(BotActivityDto { botId, events[], busy, task, cleared })`: sự kiện mới / cập nhật (cùng `id` + `seq` → FE thay theo `id`), **gộp ≤ 4 lần / giây** (`BotWatch.FlushEvery` 250 ms), chỉ gửi người đang xem bot đó; `busy`/`task` đổi (bot rảnh / `session_start` / `session_end`) cũng đẩy một lô (events có thể rỗng); `cleared` = đệm bị xoá vì rảnh quá lâu → FE xoá bảng.
- Tự ngắt (`BotWatchGuard` kiểm mỗi giây như VoiceGuard, KHÔNG kiểm trên mỗi `Move`): ra ngoài phạm vi **+1 m** (7 m) hoặc đổi kênh quá **3 giây**, bot offline / người thật vào văn phòng, người xem rời hub → `BotWatchEnded(botId, reason)` với reason `range` / `offline` / `left` rồi ngừng phát.

Phần FE (bấm vào bot trong 3D, phạm vi nghe ở client, hook `use-bot-watch`, bảng tạm — TEST-97): [office-bots-watch.md](office-bots-watch.md).
