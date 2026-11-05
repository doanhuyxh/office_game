# Văn phòng 3D & realtime (OfficeHub.Realtime)

> Nguồn sự thật là code (`backend/src/OfficeHub.Realtime/`, `frontend/src/features/office/`, `shared/office-map.json`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Host riêng, port dev 5090, route `/rt/*`. Không có DB: mọi trạng thái nằm trong RAM (`Simulation/Presence.cs`). Đăng nhập bằng cookie do Api cấp ([auth.md](auth.md#cookie-buildingblocksauthauthcookiecs)).

## Bản đồ (`shared/office-map.json`, schema `shared/schemas/office-map.schema.json`)

- `floor` {x0,x1,z0,z1}, `spawn` {x,z}, `zones[]` {id, name, x0..z1}, `objects[]` {id, prefab, x, z, r?, action?}.
- Hiện có zone `work`, `meeting`, `pantry`, `lounge`, `reception` và object `timeclock` (`action: "attendance.checkin"`) ở lễ tân. Đây là bản tạm, chưa theo mặt bằng thật.
- Realtime đọc qua `Realtime__MapPath` (`OfficeMap.Load`), FE import `@shared/office-map.json`. Sửa bản đồ → cả hai cùng đổi; Docker image Realtime copy thư mục `shared/`.

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
| `Move` ra ngoài `floor` hoặc quãng đường > `7·dt + 2.5` | không cập nhật, gửi `Teleport` về vị trí cũ |
| `SendChat` | trim, rỗng → bỏ; cắt 200 ký tự; < 1 giây từ lần trước → `HubException("Gửi chậm lại một chút")` |
| Ngắt kết nối | `Presence.Remove(userId, connectionId)` chỉ xoá nếu đúng kết nối hiện tại, rồi gửi `PlayerLeft` |

### Kiểm tra phiên (`Auth/SessionValidator.cs`, `Auth/SessionWatch.cs`)

Realtime không đọc được dữ liệu tài khoản (ranh giới module) nên hỏi Api `GET {Realtime__ApiBaseUrl}/api/auth/me` bằng chính cookie `officehub.auth*` của người dùng (lưu ở `Player.AuthCookie` lúc kết nối):

| Khi | Kết quả |
|---|---|
| Kết nối hub, xin token voice | Api 401/403 → từ chối (voice trả 401) |
| `SessionWatch` mỗi `Realtime__SessionCheckSeconds` (30s) cho mọi người online | 401/403 → `Kicked("Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.")`, `Abort` sau 500ms |
| Api không trả lời / 5xx | `Unknown` → **cho qua** (ghi log `WRN`), để Api restart không đá cả văn phòng |

Tên hiển thị = claim `full_name`. Không có va chạm đồ vật, ngồi, phòng họp, trạng thái "Vắng" (chưa làm). Realtime **chưa** phát sự kiện presence sang Attendance.

## Voice (`Voice/VoiceEndpoints.cs`)

`POST /rt/voice/token?room=<tên>` (đăng nhập) → `{ url, token, room }` (LiveKit JWT, TTL 2 giờ, grant `RoomJoin`). Phiên hết hiệu lực → 401. Thiếu cấu hình → 503 `"Voice chưa được cấu hình (LiveKit__*)"`. `LiveKit__ApiSecret` < 32 ký tự → Realtime không khởi động. Room do client tự đặt (chưa kiểm tra theo vị trí). FE chưa dùng.

## Front-end (`frontend/src/features/office/`)

| File | Vai trò |
|---|---|
| `features/office/components/OfficeView.tsx` | Trang `/office` (lazy). Dựng `OfficeScene`, mở `OfficeConnection`, vẽ HUD (tên, online, zone, chat, nút chấm công) |
| `engine/OfficeScene.ts` | Three.js thuần, không phụ thuộc React: sàn + zone + capsule có nhãn, WASD/mũi tên (tốc độ 4.2), camera bám theo, gửi `onMove` mỗi 100ms, callback `onZone`, `onNearAction` |
| `api/officeHub.ts` | `OfficeConnection`: `HubConnectionBuilder` + `MessagePackHubProtocol`, tự reconnect `[0,1000,3000,5000,10000]`, chuẩn hoá key PascalCase → camelCase |
| `store/office.store.ts` | Zustand `useOffice`: `me`, `conn`, `online`, `zone`, `chat` (giữ 50 dòng) |
| `features/office/components/office.css` | Mọi selector bọc trong `.office-root` (không được lộ ra trang khác) |

Quy tắc cần giữ khi sửa:
- Nhận `Kicked` → đặt cờ, `stop()` và **không tự reconnect** (nếu không, 2 tab sẽ đá nhau liên tục). Overlay hiện đúng `reason` (`useOffice().kickReason`), nút "Vào lại" tải lại trang (phiên hết hạn → guard đưa về `/login`).
- Effect kết nối phụ thuộc `me.id` (không phụ thuộc object `me`) và `start()` hoãn 1 tick (`setTimeout 0`) để React StrictMode không mở rồi huỷ kết nối.
- Ô chat đang focus thì phím di chuyển / `E` bị bỏ qua (kiểm tra `tagName === 'INPUT'`).

### Chấm công trong 3D

- Đứng cách object có `action` < 1.8 → `onNearAction("attendance.checkin")` → HUD hiện "Máy chấm công · bấm E để chấm công vào/ra".
- Phím `E` khi đang gần, hoặc bấm nút HUD (`data-testid="office-check"`) → `useCheck().mutate('office3d')` từ `@/features/attendance` (gọi REST `/api/attendance/check`, **không** qua hub). Quy tắc chấm công: [attendance.md](attendance.md).
- `noProfile` → nút hiện "Không chấm công" và bị tắt.
