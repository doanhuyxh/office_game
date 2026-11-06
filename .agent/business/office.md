# Văn phòng 3D & realtime (OfficeHub.Realtime)

> Nguồn sự thật là code (`backend/src/OfficeHub.Realtime/`, `frontend/src/features/office/`, `shared/office-map.json`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Host riêng, port dev 5090, route `/rt/*`. Không có DB: mọi trạng thái nằm trong RAM (`Simulation/Presence.cs`). Đăng nhập bằng cookie do Api cấp ([auth.md](auth.md#cookie-buildingblocksauthauthcookiecs)).

## Bản đồ v2 (`shared/office-map.json`, schema `shared/schemas/office-map.schema.json`)

Mặt bằng **50 × 30 m (1 500 m²)**, chủ dự án duyệt 2026-11-06 (bố trí + lý do: `design/office-1500m2-proposal.md`; bản 24 × 16 cũ: `design/office-3d-proposal.md`). File JSON **sinh bởi `design/tools/gen-map-1500.ts`** → sửa script, không sửa tay JSON (quy trình: `design/README.md`). Đơn vị mét, gốc góc tây-bắc, x sang đông, z xuống nam.

- `rooms[]` (kind office / meeting / booth / open / lounge / lobby / pantry, `zone`, `walls`, `glass`, `doors[]` {side, at, w}, `voice: "room"`), `areas[]` (khu phòng ban trong khu mở, `dept`), `seats[]` (100 chỗ, id `KTH-01`…, `MR-xx` = chỗ chưa gán phòng ban, `YT-xx` = phòng yên tĩnh; `facing` n/s/e/w), `objects[]` (`prefab`, w×d, `rot`, `solid`, `action` / `interact`), `outerDoors`, `spawn`, `grid` = 0,5.
- **Lưới va chạm** sinh khi tải (không lưu): ô bị chặn nếu giao tường (dải ±0,05 m dọc cạnh phòng có `walls` + cạnh sàn, trừ cửa) hoặc đồ vật `solid`. Code **giống hệt** ở FE `engine/navGrid.ts` và server `Simulation/NavGrid.cs`.
- **Sửa bản đồ**: sửa JSON → `bun design/tools/render-plan.ts` (vẽ `design/floor-plan.svg`, ghi `shared/office-map.grid.txt`, báo lỗi: cửa không căn lưới / rộng < 1 m, ghế bị chắn, phòng / ghế / máy chấm công không đi tới được, id trùng → exit 1). Test `tests/OfficeHub.Realtime.Tests` so lưới C# với `office-map.grid.txt` → quên chạy script hoặc 2 bản code lệch là test fail.
- `departments.MapZone` = `areas[].id` hoặc `rooms[].zone` (danh sách chọn: `features/employees/utils/mapZones.ts`). Phòng ban thử: `dept-bgd`, `dept-hcns`, `dept-kt`, `dept-kd`, `dept-kth`, `reception`; thêm `quiet` (Phòng yên tĩnh, không gán phòng ban). Phòng họp: `meeting-hall` (20), `meeting-large` (10), `meeting-small` (6); 4 phòng gọi `booth-1..4`.
- Realtime đọc qua `Realtime__MapPath` (`OfficeMap.Load`, bắt buộc `version: 2`), FE import `@shared/office-map.json`. Docker image Realtime copy thư mục `shared/`.

## Hub `/rt/hub/office` (`Hubs/OfficeRoomHub.cs`, `[Authorize]`, MessagePack)

| Hướng | Tên | Dữ liệu |
|---|---|---|
| server → client | `Welcome` | `{ selfId, mapName, players[] }` |
| | `PlayerJoined` / `PlayerLeft` | `PlayerDto { id, name, x, z, r, anim }` / `id` |
| | `Positions` | `PositionDto[]` — chỉ người đã đổi, phát mỗi 100ms (`Simulation/OfficeLoop.cs`) |
| | `Chat` | `{ id, name, text, at, channel: "office"\|"room", roomId?, roomName? }` |
| | `Teleport` | `(x, z)` — kéo về vị trí hợp lệ |
| | `Kicked` | `reason` |
| client → server | `Move(x, z, r, anim)` | |
| | `SendChat(text)` / `SendRoomChat(text)` | toàn văn phòng / chỉ phòng có tường đang đứng |

Quy tắc server:

| Tình huống | Xử lý |
|---|---|
| Cookie có `must_change_password` | `Context.Abort()` ngay khi kết nối |
| Phiên không còn hợp lệ lúc kết nối (`SessionValidator` hỏi Api → 401/403) | `Kicked(SessionWatch.ExpiredReason)` rồi `Abort` |
| Cùng tài khoản kết nối lần 2 | kết nối cũ nhận `Kicked("Tài khoản vừa đăng nhập ở nơi khác")`, bị `Abort` sau 500ms |
| `Move` tới ô bị chặn (ngoài sàn, tường, đồ vật — `OfficeMap.CanStand`; đúng toạ độ ghế ±0,05 thì cho phép) hoặc quãng đường > `7·dt + 2.5` | không cập nhật, gửi `Teleport` về vị trí cũ |
| `SendChat` | trim, rỗng → bỏ; cắt 200 ký tự; < 1 giây từ lần trước → `HubException("Gửi chậm lại một chút")` |
| `SendRoomChat` | cùng giới hạn như `SendChat`; server tự xác định phòng theo vị trí (`RoomOf`), đứng ở khu mở → `HubException`; chỉ gửi cho người đang ở trong phòng đó lúc gửi |
| Ngắt kết nối | `Presence.Remove(userId, connectionId)` chỉ xoá nếu đúng kết nối hiện tại, rồi gửi `PlayerLeft` |

### Kiểm tra phiên (`Auth/SessionValidator.cs`, `Auth/SessionWatch.cs`)

Realtime không đọc được dữ liệu tài khoản (ranh giới module) nên hỏi Api `GET {Realtime__ApiBaseUrl}/api/auth/me` bằng chính cookie `officehub.auth*` của người dùng (lưu ở `Player.AuthCookie` lúc kết nối):

| Khi | Kết quả |
|---|---|
| Kết nối hub, xin token voice | Api 401/403 → từ chối (voice trả 401) |
| `SessionWatch` mỗi `Realtime__SessionCheckSeconds` (30s) cho mọi người online | 401/403 → `Kicked("Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.")`, `Abort` sau 500ms |
| Api không trả lời / 5xx | `Unknown` → **cho qua** (ghi log `WRN`), để Api restart không đá cả văn phòng |

Tên hiển thị = claim `full_name`. `anim` (byte) chỉ chuyển tiếp: 0 đứng, 1 đi, 2 ngồi. Không làm (chủ dự án bỏ): trạng thái "Vắng" / nghỉ phép trên avatar, gán chỗ ngồi. Realtime **chưa** phát sự kiện presence sang Attendance.

## Voice (`Voice/VoiceEndpoints.cs`, `Voice/VoiceGuard.cs`) — giai đoạn 3

**Kênh theo vị trí** (`OfficeMap.VoiceAt`, giống `engine/voiceChannel.ts`): đứng trong phòng có `walls` → kênh riêng của phòng đó (room LiveKit `officehub-<rooms[].id>`); còn lại (khu mở, sảnh, pantry, khu nghỉ) → `officehub-open`. Phòng có `voice: "room"` (hội trường, họp lớn / nhỏ, 4 phòng gọi) = **phòng họp**: cả phòng nghe rõ như nhau + được chia sẻ màn hình. Phòng có tường khác (Giám đốc, Kế toán) vẫn là kênh riêng nhưng nghe theo khoảng cách.

`POST /rt/voice/token` (đăng nhập) → `{ url, token, room, channel, meeting }`:

| Quy tắc | Xử lý |
|---|---|
| Room | **Server quyết định** theo vị trí hiện tại trong `Presence` (bỏ qua mọi tham số client) → đứng ngoài không xin được token phòng họp |
| Chưa vào hub văn phòng | 409 `"Hãy vào văn phòng 3D trước khi bật voice"` |
| Phiên hết hiệu lực | 401 · thiếu `LiveKit__*` → 503 · secret < 32 ký tự → Realtime không khởi động |
| Grant | identity = userId, TTL 10 phút (chỉ để vào room; LiveKit tự gia hạn). Nguồn được publish: `microphone`; phòng họp thêm `screen_share`, `screen_share_audio`. Không có data channel |
| Đổi kênh | Cấp token room mới → đẩy khỏi room cũ (`RemoveParticipant`) |

`VoiceGuard` (mỗi giây): người có `Player.VoiceRoom` mà kênh tại vị trí khác room đó quá **3 giây** → bị đẩy khỏi room LiveKit (client chuẩn tự đổi kênh sau ~0,5 s; guard chặn client bị sửa ở lại nghe lén). Rời hub (đóng tab, bị khoá tài khoản, `Kicked`) → cũng bị đẩy khỏi voice; mở tab mới thì không (LiveKit tự thay kết nối cùng identity). API LiveKit gọi qua URL suy ra từ `LiveKit__Url` (ws → http, wss → https).

Giới hạn đã biết: kênh `open` chứa mọi người ở khu mở; giảm âm theo khoảng cách làm ở **client** → client bị sửa có thể nghe cả khu mở (chấp nhận: khu mở vốn công khai). Phòng có tường thì được server bảo vệ.

## Front-end

Engine 3D, HUD, điều khiển, quy tắc khi sửa: [office-engine.md](office-engine.md).

### Chấm công trong 3D

- Đứng cách object có `action` < 1.8 → `onNearAction("attendance.checkin")` → HUD hiện "Máy chấm công · bấm E để chấm công vào/ra".
- Phím `E` khi đang gần (và không đang ngồi; ngoài ra `E` = ngồi / đứng), hoặc bấm nút HUD (`data-testid="office-check"`) → `useCheck().mutate('office3d')` từ `@/features/attendance` (gọi REST `/api/attendance/check`, **không** qua hub). Quy tắc chấm công: [attendance.md](attendance.md).
- `noProfile` → nút hiện "Không chấm công" và bị tắt.
