# Luồng hoạt động bot — "xem trực tiếp agent đang làm gì"

> Phần tiếp của [office-bots.md](office-bots.md) / [office-bots-work.md](office-bots-work.md); FE: [office-bots-watch.md](office-bots-watch.md); runner: [agent-runner-activity.md](agent-runner-activity.md). Code: `BuildingBlocks/Office/BotActivityFeed.cs` (hợp đồng, hằng số `BotActivityFeedRoute`), Realtime `Simulation/BotActivityFeed.cs` (đệm), `Simulation/BotWatch.cs` (+ `BotWatchGuard`), `Hubs/BotActivityFeedEndpoints.cs`, `WatchBot` / `UnwatchBot` trong `Hubs/OfficeRoomHub.cs`, dọn trong `BotSweeper`; Mcp `Program.cs` (`/mcp/activity`), `Infrastructure/BotActivityGate.cs`, `BotPresenceReporter.ReportActivityAsync`, `Infrastructure/BotToolFeed.cs`. Unit test: `BotActivityFeedTests`, `BotWatchTests` (Realtime), `BotActivityGateTests`, `BotToolFeedTests` (Mcp).

Chủ dự án duyệt 2026-11-14: bấm vào bot trong 3D → bảng như chia sẻ màn hình (lệnh, diff, suy nghĩ, lời agent) theo thời gian thực. Đã chốt: luồng **có cấu trúc** (không ảnh / video); **không lưu lịch sử** (chỉ RAM, không DB / S3 / localStorage); **có hiện suy nghĩ**; bong bóng trên đầu bot **giữ nhãn thô** (`/mcp/presence`); **ai đứng trong phạm vi nghe được cũng xem được**, kiểm ở back-end. Việc: TEST-92 nền móng · 94 cửa Mcp · 95 hub xem · 96 bot không runner · 97 FE chọn bot · 98 bảng đầy đủ · 93 / 99 runner · 101 e2e + tài liệu.

```
agent-runner ─POST /mcp/activity (token bot)─▶ Mcp ─POST /rt/internal/bot-activity-feed (X-Internal-Key)─▶ Realtime BotActivityFeed (RAM)
bot gọi tool MCP (không runner) ─BotToolFeed─┘                                        └─Appended / Cleared─▶ BotWatch ─BotActivity─▶ người xem
```

## Nguồn sự kiện

- **agent-runner** (nguồn chính, chi tiết nhất): dựng sự kiện từ stream của CLI agent, gửi lô qua `POST /mcp/activity`.
- **Bot nối MCP trực tiếp** (TEST-96, `BotToolFeed`, chạy nền — lỗi chỉ ghi log): mỗi tool bot gọi → `kind: "tool"`, `title` = tiêu đề tiếng Việt của tool, `text` = tên tool + mã việc nếu tham số có `task`, `ok` = thành công / lỗi. **Không** gửi tham số khác / kết quả tool. Lần gọi đầu sau khi rảnh → tự `session_start`; 15 phút không gọi → `session_end` (`BotToolFeedSweeper`, mỗi phút). Runner còn hiệu lực (`/mcp/presence` hoặc `/mcp/activity` trong 5 phút) → không tự phát (tránh trùng), phiên tự mở bị quên.

## Hợp đồng `BotActivityEvent`

| Trường | Giới hạn | Ghi chú |
|---|---|---|
| `id` | ≤ 64, bắt buộc | Gửi lại cùng `id` = **cập nhật** (trường null giữ cũ, giữ `seq` + `at`) — vd thêm `output` / `ok` cho lệnh |
| `kind` | bắt buộc | `session_start` · `session_end` · `command` · `file_edit` · `file_write` · `file_read` · `search` · `thinking` · `say` · `tool` (phân biệt hoa thường) |
| `title` / `path` | 200 / 400, một dòng | |
| `text` | 4 000 | Lệnh / suy nghĩ / lời agent / truy vấn |
| `diff` | 200 dòng rồi 16 000 ký tự | Unified |
| `output` | 4 000, giữ **phần cuối** | |
| `ok`, `task` (200), `model` (100), `turns`, `costUsd` | | `task` = "MÃ · tên việc"; turns / costUsd cho `session_end` |
| `seq`, `at` | server gán | `seq` tăng dần theo bot (qua các phiên; mất khi Realtime khởi động lại) |

Làm sạch (`BotActivityFeed.Clean`) — **cắt, không từ chối**: quá độ dài → còn đúng giới hạn, ký tự cuối `…` (`output`: `…` ở đầu); trường nhiều dòng bỏ ký tự điều khiển trừ `\n` / `\t`; trường một dòng đổi mỗi ký tự điều khiển (`\r`, `\n`, `\t`) thành dấu cách; rỗng → null.

## Cửa vào

**`POST /mcp/activity`** (host Mcp, sau `BearerGate`, token AI của bot): body `{ events[] }` (không có `userId` — Mcp lấy từ token). Không token 401 · không phải bot 403 · > 5 lần / giây / token 429 · > 256 KB / JSON hỏng / rỗng / > 50 sự kiện / `kind` lạ / thiếu `id` → 400 cả lô · Realtime không nhận 503 · OK 204. Mcp không lưu, không ghi nội dung vào log / nhật ký AI. nginx web: `location = /mcp/activity` (`client_max_body_size 256k`).

**`POST /rt/internal/bot-activity-feed`** (nội bộ Mcp → Realtime): `{ userId, events[] }`, khoá `X-Internal-Key` = `Chat__McpToRealtimeKey` (trống → `Chat__InternalKey`); sai khoá 401, body ≤ 2 MB, cùng luật 400; OK `{ accepted, lastSeq }`. Realtime không kiểm cờ bot — Mcp phải. (Không nhầm với `/rt/internal/bot-activity` = báo presence.)

## Vòng đời đệm (`BotActivityFeed`, khoá theo bot)

- Mỗi bot **200 sự kiện gần nhất của phiên hiện tại** (tràn → bỏ cũ nhất).
- `session_start` → xoá đệm cũ rồi ghi. `session_end` → phát cho người xem rồi xoá đệm (xem sau = đệm rỗng).
- `BotSweeper` (15 s): bot offline (5 phút không gọi tool) hoặc đệm không có sự kiện mới quá 5 phút → xoá, phát `Cleared`.
- Móc: `Appended(userId, e)` (mới / cập nhật, gọi trong khoá bot — người nghe chỉ xếp hàng), `Cleared(userId)`; `Snapshot(userId)` cho người mới mở.

## Phạm vi xem + hub `/rt/hub/office` (`BotWatch`)

**Nghe được** (`OfficeMap.CanHear`, luật voice): cùng kênh voice (`VoiceAt`: phòng có tường chứa điểm, còn lại "open"); phòng `voice: "room"` → cả phòng; còn lại → ≤ `HearRange` **6 m** (PHẢI khớp `VOICE_FAR` FE). Đứng sát nhưng khác bên tường → không.

- `WatchBot(botUserId)` → `BotWatchDto { botId, name, busy, task, events[] }` (đệm hiện tại). Từ chối (HubException): chưa vào hub; không phải bot đang hiện trong 3D (người thật của tài khoản đang trong văn phòng); ngoài phạm vi → "Hãy lại gần hơn để xem". Mỗi kết nối xem **một** bot (gọi lại = đổi). `UnwatchBot()` / ngắt kết nối → thôi.
- `BotActivity(BotActivityDto { botId, events[], busy, task, cleared })` chỉ tới người đang xem bot đó, **gộp ≤ 4 lô / giây** (250 ms); `busy` / `task` đổi cũng đẩy lô (events có thể rỗng); `cleared` → FE xoá bảng.
- `BotWatchGuard` mỗi giây (không theo `Move`): ra ngoài **7 m** (+1 m) hoặc khác kênh quá **3 giây** → `BotWatchEnded(botId, "range")`; bot offline / người thật vào → `"offline"`; người xem rời hub → `"left"`. Sau đó không phát nữa.

## Giao diện

Bấm / chạm avatar bot → kiểm phạm vi ở client (chỉ gợi ý) → `WatchBot`; bảng nổi "Màn hình của bot" (TEST-98, `components/bot-activity-panel/` + `bot-activity-event/`): đầu bảng (tên bot, ● Trực tiếp, việc, model · thời gian đã chạy · lượt · chi phí) + dòng thời gian tự cuộn — lệnh = khối terminal (dấu quay khi chưa có kết quả, `output` cùng `id` về sau gắn đúng khối), file = đường dẫn + diff `-` đỏ / `+` xanh, đọc / tìm / tool = một dòng, suy nghĩ = chữ nghiêng mờ, lời agent = Markdown `noImages`, phiên = vạch ngăn. Nội dung agent sinh ra coi là **không tin cậy**: chỉ vẽ văn bản thuần. Chi tiết: [office-bots-watch.md](office-bots-watch.md).

## Kiểm thử

- Unit: các file test ở đầu trang (`dotnet test`).
- `scripts/dev/bot-activity-e2e.ts` (TEST-101, Api + Realtime + Mcp, không FE, **DB tạm**): giả runner bằng `/mcp/presence` + `/mcp/activity`, người xem đi bộ bằng `Move` theo `navGrid` — 401 / 403 / 400, đệm + sự kiện mới đúng `seq`, cùng `id` cập nhật tại chỗ, xa > 6 m / ngoài tường bị từ chối và không nhận gì, góc xa Hội trường vẫn xem, đi xa → `range` ≤ 5 s, `session_end` → đệm rỗng + rảnh, tràn 200, cắt trường dài, bot không runner → `tool` không lộ tham số. Lệnh ở đầu file; kết quả trong [e2e.md](../e2e.md).
- `scripts/dev/bot-watch-e2e.ts` (TEST-97, FE Chrome).

## Mặc định chưa chốt riêng với chủ dự án

Do dev đặt, đổi bằng hằng số: đệm **200** sự kiện / bot · ngưỡng **6 m**, ngắt khi **7 m** / sau **3 giây** · gộp 250 ms · giới hạn độ dài (bảng trên) · 50 sự kiện / lô, 5 lần / giây, 256 KB · đệm rảnh 5 phút thì xoá · bot không runner: 15 phút không gọi tool = hết phiên.
