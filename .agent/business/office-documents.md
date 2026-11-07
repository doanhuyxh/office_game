# Tài liệu trong văn phòng 3D

> Nguồn sự thật là code (`frontend/src/features/office/components/OfficeDocs.tsx`, `OfficeView.tsx`, `backend/src/OfficeHub.Realtime/Screens/RoomScreens.cs`, hub `PinScreen`…). Kho tài liệu: [documents.md](documents.md) · văn phòng / hub: [office.md](office.md) · engine: [office-engine.md](office-engine.md). Về [README.md](README.md).

Chủ dự án chốt 2026-11-07: làm cả 4 phần — nút HUD, tủ hồ sơ / kệ thư viện, chiếu tài liệu lên màn hình phòng, bảng tin.

## Đồ vật tương tác (bản đồ)

`objects[].interact` (sinh từ `design/tools/gen-map-1500.ts`): `documents` = tủ hồ sơ (`west-cabinet`, `hcns-cabinet-1..2`, `kt-cabinet-1..5`), `library` = kệ thư viện mini (`library-shelf-1..2`), `screen` = TV phòng (sẵn có), `notices` = bảng tin (sẵn có). `OfficeScene` coi các đồ vật `action` + `interact` ∈ {documents, library, screen, notices} là tương tác được: đứng < 1,8 m → `onNearAction("interact:<id>")` (máy chấm công vẫn `"attendance.checkin"`). `coffee` / `printer` / `game` chưa có hành động. HUD hiện gợi ý "🗄 Tủ hồ sơ · bấm E…"; **E** (hoặc chạm khung gợi ý): đang ngồi → đứng; máy chấm công → chấm công; đồ vật → mở; còn lại → ngồi.

| Đồ vật | Bấm E |
|---|---|
| Tủ hồ sơ | Kho của phòng ban có khu (`departments.MapZone` = area / room zone) **gần tủ nhất ≤ 5 m** (`useCabinetDepartment`); không có quyền kho đó → toast "Bạn không có quyền mở tủ hồ sơ của …"; không thuộc phòng nào → kho mặc định |
| Kệ thư viện | Kho chung công ty |
| Bảng tin | Tài liệu mới ban hành 60 ngày (`GET /api/documents/recent`, theo quyền người xem) |
| Màn hình (trong phòng có tường) | Chọn tài liệu để **chiếu**; TV ở khu mở → "chỉ để xem" |

- Nút **"📁 Tài liệu"** (thẻ tên HUD): mở kho mặc định = kho phòng ban đầu tiên ghi được (thường là phòng mình), không có → kho công ty. Đang ở phòng có tường → chi tiết tài liệu có nút "Chiếu lên màn hình phòng".
- **Kéo thả** file / thư mục vào văn phòng → tải lên kho mặc định (gốc kho, giữ cấu trúc thư mục), hàng đợi hiện giữa dưới màn hình.
- Hộp thoại dùng `DocumentsBrowser` của feature documents (kho + thư mục + tải lên + chi tiết). Đang thao tác trong hộp thoại (`[role=dialog]`) / ô nhập → WASD, Q, R, E, M không điều khiển nhân vật (`isTyping` / `typingTarget`).

## Chiếu tài liệu lên màn hình phòng (Realtime)

| Hướng | Tên | Ghi chú |
|---|---|---|
| client → server | `PinScreen(assetId)` | Phòng = phòng có tường đang đứng (`RoomOf`, server quyết định); khu mở → `HubException`. 1 lần / 3 s. Server gọi Api **bằng cookie người chiếu**: `GET /api/documents/assets/{id}` (tiêu đề) + `GET …/file?present=true` (presigned 3 giờ, Api kiểm tra quyền + ghi nhật ký "Xem"); lỗi → `HubException` tiếng Việt (404/403 → "Không tìm thấy tài liệu hoặc bạn không có quyền xem", 410 → đã huỷ) |
| | `ClearScreen()` | Ai trong phòng cũng tắt được |
| | `GetScreen()` | Tài liệu đang chiếu ở phòng mình đứng (client hỏi sau khi đổi phòng 600 ms, chỉ nhận kết quả khác null) |
| server → client | `ScreenChanged(roomId, ScreenDto?)` | Chỉ gửi người đang ở trong phòng; `Move` vào phòng đang chiếu → server gửi ngay cho người đó |

- `ScreenDto { roomId, roomName, assetId, title, fileName, contentType, kind, url, inline, byName, at }` — `RoomScreens` giữ trong RAM, tự hết sau 170 phút (link 3 giờ). URL chỉ nhận http/https (`RoomScreens.Parse`, test `RoomScreensTests`).
- **Chiếu = chia sẻ tạm**: người cùng phòng xem bằng link của người chiếu dù không có quyền kho đó (như đưa tài liệu lên màn hình thật). Chỉ người chiếu cần quyền.
- HUD `ScreenDocPanel`: ảnh / video / âm thanh / PDF, văn bản thuần xem trực tiếp; loại khác → link mở / tải. Nút Phóng to, Mở tab mới, Tắt chiếu. Ra khỏi phòng → khung biến mất.

E2E: `scripts/dev/office-docs-e2e.ts` (25 kiểm tra, 2 Chrome, DB tạm + Realtime + Vite) — [e2e.md](../e2e.md). Kéo thả file chưa có trong e2e (CDP khó giả lập file thật).

**Chưa làm:** hiện tiêu đề / ảnh tài liệu lên chính mặt TV 3D, điều khiển trang PDF đồng bộ cho cả phòng.
