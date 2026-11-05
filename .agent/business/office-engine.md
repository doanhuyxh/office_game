# Văn phòng 3D — engine front-end

> Nguồn sự thật là code (`frontend/src/features/office/`). Bản đồ, hub, server: [office.md](office.md). Về [README.md](README.md).

| File | Vai trò |
|---|---|
| `components/OfficeView.tsx` | Trang `/office` (lazy). Dựng `OfficeScene`, mở `OfficeConnection`, HUD: tên, online, khu, chat, nút chấm công, nhắc ghế, hướng dẫn, nút xoay camera |
| `components/Minimap.tsx` | Bản đồ nhỏ (canvas ~7 fps): mình, người khác, điểm đang tới; bấm → `scene.walkTo` |
| `engine/OfficeScene.ts` | Điều phối (Three.js thuần, không React): camera chéo (Q / R xoay 90°, cuộn zoom 8–32), WASD theo hướng màn hình + trượt theo tường (`nav.fits`, bán kính 0,22), bấm chuột → A*, bấm sát ghế → đi tới rồi ngồi, `toggleSit()`, gửi `Move` mỗi 100 ms, callback `onZone` / `onNearAction` / `onSeat` / `onHint`, `snapshot()` cho minimap |
| `engine/navGrid.ts` | Lưới va chạm, A* 8 hướng (không cắt góc) + làm mượt, `nearestFree`, `zoneAt` (khu phòng ban trước, rồi phòng) |
| `engine/world.ts` | Phần tĩnh: sàn theo loại phòng, thảm khu phòng ban, tường thấp 1,1 m (cắt ngang để nhìn vào phòng), vách kính 2,2 m trong suốt, đồ đạc gộp theo vật liệu (vài draw call), tên phòng trên sàn, logo sảnh |
| `engine/furniture.ts` | Đồ đạc low-poly dựng bằng khối theo `prefab` (chưa dùng file GLB; prefab lạ → hộp xám) |
| `engine/avatar.ts` | Nhân vật có khớp tay / chân: đi, đứng, ngồi; màu áo / tóc theo id; nhãn tên (mình: nền xanh + vòng dưới chân) |
| `engine/officeMap.ts`, `mapTypes.ts`, `palette.ts` | Bản đồ có kiểu, `FACING_ANGLE`, bảng màu cảnh |
| `api/officeHub.ts`, `store/office.store.ts`, `components/office.css` | Như trước (SignalR + MessagePack, Zustand, CSS bọc `.office-root`) |

Quy tắc cần giữ khi sửa:
- Nhận `Kicked` → đặt cờ, `stop()` và **không tự reconnect** (2 tab sẽ đá nhau). Overlay hiện `kickReason`, "Vào lại" tải lại trang.
- Effect kết nối phụ thuộc `me.id` và `start()` hoãn 1 tick (`setTimeout 0`) vì React StrictMode.
- Ô chat đang focus thì phím di chuyển / `E` / `Q` / `R` bị bỏ qua.
- Ngồi: chỉ ghế trống (không có người khác `anim = 2` trong 0,15 m), đứng dậy = bước ra ô trống gần nhất. Ghế có thể nằm trong ô chạm cạnh bàn → server cho phép riêng toạ độ ghế.
- Khi dev, `window.__officeScene` trỏ tới scene (chỉ để test e2e; không có trong bản build).

**Giai đoạn tiếp theo** (lộ trình `design/office-3d-proposal.md`): gán chỗ ngồi trong trang Nhân viên, trạng thái trên đầu avatar (chấm công, nghỉ phép, vắng), "tìm đồng nghiệp", rồi voice theo khoảng cách / phòng (LiveKit), thay khối dựng tay bằng model GLB.
