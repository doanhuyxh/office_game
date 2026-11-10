# Bot trong văn phòng 3D

> Nguồn sự thật là code: `OfficeHub.Mcp/Infrastructure/BotPresenceReporter.cs`, `OfficeHub.Realtime/Simulation/BotPresence.cs`, `OfficeHub.Realtime/Hubs/BotEndpoints.cs`, `BuildingBlocks/Office/BotActivity.cs`. Về [README.md](README.md) · văn phòng: [office.md](office.md) · MCP: [mcp.md](mcp.md).

Tài khoản **bot** (agent AI bên ngoài làm việc qua MCP) hiện trong văn phòng 3D khi đang làm việc: ngồi ở bàn trong khu phòng ban, nhãn tím **"AI · tên"**, bong bóng "đang làm gì". Chủ dự án chốt 2026-11-10.

## Quyết định đã chốt (đừng đề xuất lại)

- **Chỉ bot**, không áp cho nhân viên thật thỉnh thoảng dùng Claude. Nhận diện bằng **cờ trên tài khoản** `identity.users.IsBot` do HR đặt (chủ dự án chọn thay cho cờ trên token). Cờ không đổi quyền gì. Bàn giao tài khoản cho người thật → HR bỏ cờ.
- **Online** = gọi tool MCP (thành công) trong **5 phút** gần nhất (`BotActivityRoute.OnlineMinutes`). MCP stateless nên không có "đang kết nối".
- **Ở đâu + làm gì**: cả hai — bàn trong khu phòng ban + dòng trạng thái = tiêu đề tool + đối tượng (`Chuyển trạng thái việc · WEB-12`; id dạng Guid bị bỏ).

## Luồng

```
Bot ──tool──▶ OfficeHub.Mcp ──(call-tool filter, chạy nền)──▶ POST /rt/internal/bot-activity (X-Internal-Key = Chat__InternalKey)
                 └─ /api/auth/me (isBot, tên, avatar) + /api/org/employees/me + /api/org/departments (MapZone) — nhớ 5 phút / token
Realtime: BotPresence (RAM) → PlayerJoined { bot: true, status } / BotStatus(id, status) / PlayerLeft ; BotSweeper 15 s xoá bot quá hạn
```

- Mcp: tool lỗi → không báo. Không phải bot → nhớ "không phải bot" 5 phút (HR bật / tắt cờ có hiệu lực sau ≤ 5 phút). Thiếu `Chat__InternalKey` → tắt. Realtime lỗi → chỉ ghi log, tool vẫn chạy. Địa chỉ Realtime: `Mcp__RealtimeBaseUrl`.
- Khu: `departments.MapZone`; phòng con chưa đặt → phòng cha gần nhất.

## Xếp bàn (`BotPresence.PickSeat`)

| Thứ tự | Bàn |
|---|---|
| 1 | `seats[]` có `zone` = khu phòng ban |
| 2 | khu làm việc chung `work` (ghế `MR-xx`) |
| 3 | bàn bất kỳ; không còn bàn → đứng ở `spawn` |

Bỏ qua bàn của bot khác và bàn có người đang ngồi (`anim` 2). Thử trước bàn theo băm FNV-1a của userId → cùng bot thường về cùng bàn. Đổi khu → gỡ avatar rồi đặt lại (`PlayerLeft` + `PlayerJoined`).

## Bot và người thật cùng tài khoản

| Tình huống | Xử lý |
|---|---|
| Người thật đang trong văn phòng | Không tạo avatar bot; `BotStatus` gắn bong bóng lên avatar người thật |
| Người thật vào khi bot đang hiện | Gửi `PlayerLeft(id)` trước `PlayerJoined` người thật |
| Người thật rời, bot còn hạn | `PlayerJoined` lại avatar bot |
| Bot hết hạn | Có người thật → `BotStatus(id, null)`; không → `PlayerLeft(id)` |

Bot không có trong `Presence` → không voice, không chat, không chiếu màn hình, không chặn `Move`.

## HR

`PUT /api/org/employees/{id}/account/bot` `{ isBot }` → 204 (HR; 404 nếu chưa có tài khoản). `AccountSummary.isBot`, `MeResponse.isBot`. FE: bảng nhân viên → menu "Đánh dấu là bot (AI)" / "Bỏ đánh dấu bot", cột Tài khoản hiện "· Bot". HUD 3D: "N người online · M AI".
