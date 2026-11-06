# Văn phòng 3D — engine front-end

> Nguồn sự thật là code (`frontend/src/features/office/`). Bản đồ, hub, server: [office.md](office.md). Về [README.md](README.md).

| File | Vai trò |
|---|---|
| `components/OfficeView.tsx` | Trang `/office` (lazy). Dựng `OfficeScene`, mở `OfficeConnection`, HUD: tên, online, khu, chat 2 tab (Toàn văn phòng / phòng đang đứng — tab phòng chỉ hiện khi trong phòng có tường; thu gọn được), nút chấm công, nhắc ghế (bấm được), hướng dẫn, nút xoay camera. Thiết bị cảm ứng (`pointer: coarse`): joystick + nút zoom ＋/－ |
| `components/Minimap.tsx` | Bản đồ nhỏ (canvas ~7 fps): mình, người khác, điểm đang tới; bấm → `scene.walkTo` |
| `engine/OfficeScene.ts` | Điều phối (Three.js thuần, không React): camera chéo (Q / R xoay 90°, cuộn zoom 8–40), nắng + khung bóng đổ ±16 × ±12 m đi theo điểm camera nhìn (`moveSun`, vì sàn 68 × 30 m), WASD theo hướng màn hình + trượt theo tường (`nav.fits`, bán kính 0,22), bấm chuột → A*, bấm sát ghế → đi tới rồi ngồi, `toggleSit()`, gửi `Move` mỗi 100 ms, callback `onZone` / `onNearAction` / `onSeat` / `onHint`, `snapshot()` cho minimap |
| `engine/navGrid.ts` | Lưới va chạm, A* 8 hướng (không cắt góc) + làm mượt, `nearestFree`, `zoneAt` (khu phòng ban trước, rồi phòng) |
| `engine/world.ts` | Phần tĩnh: sàn theo loại phòng, thảm khu phòng ban, tường thấp 1,1 m (cắt ngang để nhìn vào phòng), vách kính 2,2 m trong suốt, đồ đạc gộp theo vật liệu (vài draw call), tên phòng trên sàn, logo sảnh |
| `engine/furniture.ts` | Đồ đạc low-poly dựng bằng khối theo `prefab` (dự phòng khi không có GLB; prefab lạ → hộp xám; studio: `greenScreen`, `studioLight`, `cameraTripod`) |
| `engine/models.ts` | `loadFurnitureModels()` đọc `public/models/furniture/manifest.json` (prefab → file `.glb`, `rotY`), `placeModel` co model vừa ô w×d. Có model → `buildWorld(map, models)` thay khối; không có file → giữ khối dựng tay. Nhập bộ Kenney Furniture Kit (CC0, tải tay): `bun scripts/dev/import-furniture.ts <zip\|thư-mục>` |
| `components/Joystick.tsx` | Joystick cảm ứng → `scene.setStick(x, y)` (vùng chết 0,15) |
| `engine/avatar.ts` | Nhân vật có khớp tay / chân: đi, đứng, ngồi; màu áo / tóc theo id; nhãn tên (mình: nền xanh + vòng dưới chân) |
| `engine/officeMap.ts`, `mapTypes.ts`, `palette.ts` | Bản đồ có kiểu, `FACING_ANGLE`, bảng màu cảnh |
| `api/officeHub.ts`, `store/office.store.ts`, `components/office.css` | Như trước (SignalR + MessagePack, Zustand, CSS bọc `.office-root`) |
| `api/voiceClient.ts` | `VoiceClient` (không React): **tự vào voice khi nhận `Welcome`** (để nghe; micro mặc định tắt, chỉ xin quyền khi bật), tắt loa = vẫn trong kênh nhưng âm lượng 0, lỗi → thẻ voice hiện lý do + "Kết nối lại" (không toast), đổi kênh khi `scene.onVoiceChannel` (chờ 400 ms ở cửa), xin token (server trả kênh khác → hỏi lại tối đa 6 lần / 500 ms), `autoSubscribe: false` + 4 lần/giây bật / tắt nhận âm và chỉnh âm lượng theo khoảng cách, micro, chia sẻ màn hình, `ActiveSpeakers` → `scene.setSpeaking`. `livekit-client` chỉ `import()` khi bật voice lần đầu (chunk riêng ~570 KB) |
| `engine/voiceChannel.ts` | `voiceChannelAt` (giống `OfficeMap.VoiceAt`), `voiceVolume`: ≤ 2 m = 1, giảm bậc 2 tới 0 ở 6 m; ngoài 6 m (+1 m trễ) huỷ nhận âm |
| `components/VoicePanel.tsx` | Thẻ voice (góc dưới phải): micro (`M`, mặc định tắt) / Loa / Chia sẻ (chỉ phòng họp); trình duyệt chặn autoplay → lần bấm / gõ phím đầu tiên tự mở âm thanh (còn nút "Bấm để nghe âm thanh"); `ScreenView` hiện màn hình được chia sẻ (bấm để phóng to) |

Quy tắc cần giữ khi sửa:
- Nhận `Kicked` → đặt cờ, `stop()` và **không tự reconnect** (2 tab sẽ đá nhau). Overlay hiện `kickReason`, "Vào lại" tải lại trang.
- Effect kết nối phụ thuộc `me.id` và `start()` hoãn 1 tick (`setTimeout 0`) vì React StrictMode.
- Ô chat đang focus thì phím di chuyển / `E` / `Q` / `R` bị bỏ qua.
- Ngồi: chỗ ngồi = bàn làm việc (`seats[]`) + ghế / ghế lười / sofa trong `objects[]` (`engine/sitSpots.ts`: ghế quay về bàn / quầy gần nhất như lúc vẽ, sofa chia ~0,8 m một chỗ; HUD hiện "bàn KTH-02" / "ghế · Phòng gọi 1"). Thêm prefab ngồi được → sửa cả `SITTABLE_PREFABS` và `OfficeMap.Sittable` (server). Chỉ ghế trống (không có người khác `anim = 2` trong 0,15 m), đứng dậy = bước ra ô trống gần nhất. Ghế có thể nằm trong ô chạm cạnh bàn → server cho phép riêng toạ độ ghế.
- Khi dev, `window.__officeScene` / `window.__officeVoice` trỏ tới scene / voice (chỉ để test e2e; không có trong bản build).
- Voice: identity LiveKit = id người chơi trên hub (userId) → vị trí lấy từ scene. Người đang nói có vòng xanh lá dưới chân (`Avatar.speaking`). Bị `Kicked` → tắt voice. Đổi luật kênh → sửa cả `voiceChannel.ts` và `OfficeMap.VoiceAt` (+ test `Voice_channel_by_position`).

**Lộ trình** (`design/office-3d-proposal.md`): giai đoạn 2 (gán chỗ ngồi, trạng thái trên avatar, tìm đồng nghiệp) **đã bỏ theo quyết định chủ dự án** — không đề xuất lại. Voice (giai đoạn 3) ✅, chat theo phòng ✅, hạ tầng model GLB ✅ (chờ chủ dự án tải bộ Kenney), mobile (joystick, zoom, HUD gọn) ✅. Còn: sửa bản đồ trong app, TURN cho voice khi deploy.
