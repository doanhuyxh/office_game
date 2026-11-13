# Luồng hoạt động bot — "xem trực tiếp agent đang làm gì"

> Phần tiếp của [office-bots.md](office-bots.md) / [office-bots-work.md](office-bots-work.md). Code: `BuildingBlocks/Office/BotActivityFeed.cs` (hợp đồng), `OfficeHub.Realtime/Simulation/BotActivityFeed.cs` (đệm RAM), `Hubs/BotActivityFeedEndpoints.cs`, dọn trong `BotSweeper` (`Hubs/BotEndpoints.cs`). Test: `tests/OfficeHub.Realtime.Tests/BotActivityFeedTests.cs`.

Chủ dự án duyệt 2026-11-14: bấm vào bot trong 3D → bảng giống chia sẻ màn hình: lệnh đang chạy, file đang sửa (diff), suy nghĩ, lời agent theo thời gian thực. Đã chốt: luồng **có cấu trúc** (không ảnh / video); **không lưu lịch sử** (chỉ RAM, không DB / S3); **có hiện suy nghĩ**; bong bóng trên đầu bot **giữ nhãn thô** như cũ (`/mcp/presence`, không đưa lệnh / đường dẫn lên bong bóng).

TEST-92 (nền móng) = hợp đồng + đệm Realtime + endpoint nội bộ + điểm móc. Endpoint Mcp, hub xem, FE, agent-runner là các việc sau.

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

## Vòng đời đệm (`BotActivityFeed`, singleton, thread-safe — khoá theo bot)

- Mỗi bot một vòng đệm **200 sự kiện gần nhất của phiên hiện tại** (tràn → bỏ cũ nhất).
- `session_start` → xoá đệm cũ rồi ghi sự kiện. `session_end` → phát cho người nghe (có `seq`) rồi xoá đệm, không giữ.
- `BotSweeper` (15 s): bot offline (`BotPresence.Expire`, 5 phút không gọi tool) → `Clear`; đệm không có sự kiện mới quá 5 phút (`BotActivityFeed.Idle`) → xoá.
- `Snapshot(userId)` — bản sao đệm cho người mới mở bảng.

## Điểm móc cho hub xem (việc sau)

- `event Appended(userId, BotActivityEvent)` — sự kiện mới / cập nhật (cập nhật giữ `seq` → client thay theo `id`), gồm cả `session_end`. Gọi **trong khoá của bot** để giữ đúng thứ tự `seq`: người nghe chỉ được xếp hàng gửi (không `await`, không chặn).
- `event Cleared(userId)` — đệm bị xoá do offline / rảnh (chỉ phát khi đệm còn sự kiện).
