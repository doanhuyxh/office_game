# Văn phòng 3D & realtime (OfficeHub.Realtime)

> Nguồn sự thật là code (`backend/src/OfficeHub.Realtime/`, `frontend/src/features/office/`, `shared/office-map.json`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Host riêng, port dev 5090, route `/rt/*`. Không có DB: mọi trạng thái nằm trong RAM (`Simulation/Presence.cs`). Đăng nhập bằng cookie do Api cấp ([auth.md](auth.md#cookie-buildingblocksauthauthcookiecs)).

## Bản đồ v2 (`shared/office-map.json`, schema `shared/schemas/office-map.schema.json`)

Mặt bằng 24 × 16 m do Claude đề xuất, chủ dự án duyệt 2026-11-05 (lý do bố trí: `design/office-3d-proposal.md`). Đơn vị mét, gốc góc tây-bắc, x sang đông, z xuống nam.

- `rooms[]` (kind office / meeting / booth / open / lounge / lobby / pantry, `zone`, `walls`, `glass`, `doors[]` {side, at, w}, `voice: "room"`), `areas[]` (khu phòng ban trong khu mở, `dept`), `seats[]` (24 chỗ, id `KTH-01`…, `facing`), `objects[]` (`prefab`, w×d, `rot`, `solid`, `action` / `interact`), `outerDoors`, `spawn`, `grid` = 0,5.
- **Lưới va chạm** sinh khi tải (không lưu): ô bị chặn nếu giao tường (dải ±0,05 m dọc cạnh phòng có `walls` + cạnh sàn, trừ cửa) hoặc đồ vật `solid`. Code **giống hệt** ở FE `engine/navGrid.ts` và server `Simulation/NavGrid.cs`.
- **Sửa bản đồ**: sửa JSON → `bun design/tools/render-plan.ts` (vẽ `design/floor-plan.svg`, ghi `shared/office-map.grid.txt`, báo lỗi: cửa không căn lưới / rộng < 1 m, ghế bị chắn, phòng / ghế / máy chấm công không đi tới được, id trùng → exit 1). Test `tests/OfficeHub.Realtime.Tests` so lưới C# với `office-map.grid.txt` → quên chạy script hoặc 2 bản code lệch là test fail.
- `departments.MapZone` = `areas[].id` hoặc `rooms[].zone` (danh sách chọn: `features/employees/utils/mapZones.ts`). Phòng ban thử: `dept-bgd`, `dept-hcns`, `dept-kt`, `dept-kd`, `dept-kth`, `reception`.
- Realtime đọc qua `Realtime__MapPath` (`OfficeMap.Load`, bắt buộc `version: 2`), FE import `@shared/office-map.json`. Docker image Realtime copy thư mục `shared/`.

## Hub `/rt/hub/office` (`Hubs/OfficeRoomHub.cs`, `[Authorize]`, MessagePack)

| Hướng | Tên | Dữ liệu |
|---|---|---|
| server → client | `Welcome` | `{ selfId, mapName, players[] }` |
| | `PlayerJoined` / `PlayerLeft` | `PlayerDto { id, name, x, z, r, anim }` / `id` |
| | `Positions` | `PositionDto[]` — chỉ người đã đổi, phát mỗi 100ms (`Simulation/OfficeLoop.cs`) |
| | `Chat` | `{ id, name, text, at }` |
| | `Teleport` | `(x, z)` — kéo về vị trí hợp lệ |
| | `Kicked` | `reason` |
| client → server | `Move(x, z, r, anim)` | |
| | `SendChat(text)` | |

Quy tắc server:

| Tình huống | Xử lý |
|---|---|
| Cookie có `must_change_password` | `Context.Abort()` ngay khi kết nối |
| Phiên không còn hợp lệ lúc kết nối (`SessionValidator` hỏi Api → 401/403) | `Kicked(SessionWatch.ExpiredReason)` rồi `Abort` |
| Cùng tài khoản kết nối lần 2 | kết nối cũ nhận `Kicked("Tài khoản vừa đăng nhập ở nơi khác")`, bị `Abort` sau 500ms |
| `Move` tới ô bị chặn (ngoài sàn, tường, đồ vật — `OfficeMap.CanStand`; đúng toạ độ ghế ±0,05 thì cho phép) hoặc quãng đường > `7·dt + 2.5` | không cập nhật, gửi `Teleport` về vị trí cũ |
| `SendChat` | trim, rỗng → bỏ; cắt 200 ký tự; < 1 giây từ lần trước → `HubException("Gửi chậm lại một chút")` |
| Ngắt kết nối | `Presence.Remove(userId, connectionId)` chỉ xoá nếu đúng kết nối hiện tại, rồi gửi `PlayerLeft` |

### Kiểm tra phiên (`Auth/SessionValidator.cs`, `Auth/SessionWatch.cs`)

Realtime không đọc được dữ liệu tài khoản (ranh giới module) nên hỏi Api `GET {Realtime__ApiBaseUrl}/api/auth/me` bằng chính cookie `officehub.auth*` của người dùng (lưu ở `Player.AuthCookie` lúc kết nối):

| Khi | Kết quả |
|---|---|
| Kết nối hub, xin token voice | Api 401/403 → từ chối (voice trả 401) |
| `SessionWatch` mỗi `Realtime__SessionCheckSeconds` (30s) cho mọi người online | 401/403 → `Kicked("Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.")`, `Abort` sau 500ms |
| Api không trả lời / 5xx | `Unknown` → **cho qua** (ghi log `WRN`), để Api restart không đá cả văn phòng |

Tên hiển thị = claim `full_name`. `anim` (byte) chỉ chuyển tiếp: 0 đứng, 1 đi, 2 ngồi. Không làm (chủ dự án bỏ): trạng thái "Vắng" / nghỉ phép trên avatar, gán chỗ ngồi. Chưa có: voice theo phòng (giai đoạn 3). Realtime **chưa** phát sự kiện presence sang Attendance.

## Voice (`Voice/VoiceEndpoints.cs`)

`POST /rt/voice/token?room=<tên>` (đăng nhập) → `{ url, token, room }` (LiveKit JWT, TTL 2 giờ, grant `RoomJoin`). Phiên hết hiệu lực → 401. Thiếu cấu hình → 503 `"Voice chưa được cấu hình (LiveKit__*)"`. `LiveKit__ApiSecret` < 32 ký tự → Realtime không khởi động. Room do client tự đặt (chưa kiểm tra theo vị trí). FE chưa dùng.

## Front-end

Engine 3D, HUD, điều khiển, quy tắc khi sửa: [office-engine.md](office-engine.md).

### Chấm công trong 3D

- Đứng cách object có `action` < 1.8 → `onNearAction("attendance.checkin")` → HUD hiện "Máy chấm công · bấm E để chấm công vào/ra".
- Phím `E` khi đang gần (và không đang ngồi; ngoài ra `E` = ngồi / đứng), hoặc bấm nút HUD (`data-testid="office-check"`) → `useCheck().mutate('office3d')` từ `@/features/attendance` (gọi REST `/api/attendance/check`, **không** qua hub). Quy tắc chấm công: [attendance.md](attendance.md).
- `noProfile` → nút hiện "Không chấm công" và bị tắt.
