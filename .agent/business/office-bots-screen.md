# Bot chiếu màn hình / tài liệu lên TV phòng họp

> Phần tiếp của [office-bots.md](office-bots.md) (đi lại `go_to`). Code: `OfficeHub.Realtime/Screens/BotScreens.cs`, `Hubs/BotScreenEndpoints.cs`, `Mcp/Tools/OfficeTools.cs` (`present_*`), FE `features/office/components/live-image`, `office-docs` (`ScreenDocPanel`). Chiếu tài liệu của người: [office-documents.md](office-documents.md).

Chủ dự án chọn 2026-11-11 **cách 1 — ảnh chụp màn hình cập nhật** (không phải video LiveKit). Mức tôi tự chọn (chưa chốt riêng): ≤ 1 ảnh / 3 giây; chỉ người trong phòng xem; ảnh **chỉ trong RAM** (khung mới nhất), không S3.

## Tool MCP (chỉ tài khoản bot)

| Tool | Việc |
|---|---|
| `present_screen(image, caption?)` | Ảnh chụp màn hình agent (PNG / JPEG / WebP base64, có thể kèm `data:image/…;base64,`, ≤ 2 MB) → TV phòng bot đang ở. Gọi lại = khung mới |
| `present_markdown(content, title?)` | Trang Markdown (GFM: tiêu đề, checklist, bảng, code) → TV phòng; **cách trình bày chính** (2026-11-12): mỗi lần vài trăm token, còn ảnh base64 thì mô hình phải tự sinh hàng chục nghìn token nên thực tế agent chỉ gửi được 1 khung. Gọi lại = thay cả trang, ≥ 1 giây / lần, ≤ 20.000 ký tự (bỏ ký tự điều khiển). Bong bóng `📝 Đang trình bày` |
| `present_document(document)` | Tài liệu trong kho (id / TL-… / số hiệu): Mcp gọi Api bằng token bot `GET /api/documents/assets/{id}` + `/file?present=true` (Api kiểm quyền + ghi nhật ký xem) → Realtime `RoomScreens.Parse` |
| `stop_presenting()` | Tắt màn hình bot ở phòng mình |

Mcp → Realtime `POST /rt/internal/bot-screen` (`BotScreenRequest { activity, mode: frame | markdown | document | stop, image, caption, markdown, detailJson, fileJson }`, khoá `Chat__InternalKey`). Bong bóng trên đầu bot: `🖥 Đang chiếu màn hình` (không lặp ảnh).

## Quy tắc (Realtime)

- Bot phải **đã tới** một phòng có tường (`Bot.Spot.RoomId`, hết đường đi) → không thì 409 "go_to phòng họp trước". Người thật của tài khoản đang trong 3D → 409.
- Ảnh: nhận diện bằng chữ ký file (`DetectImage`, không tin tên / content-type), sai → 400; kiểm ảnh **trước** tần suất; < 3 giây từ khung trước → 429.
- Khung lưu ở `BotPresentation` (theo phòng, mã ngẫu nhiên 128 bit); `ScreenDto { assetId: "bot:<userId>", kind: Image, url: /rt/screens/{phòng}/{mã}?v={số khung}, live: true }` → `RoomScreens.Set` + `ScreenChanged` cho người đang trong phòng (như `PinScreen`). Bot khác chiếu ở cùng phòng → thay (mã mới).
- `GET /rt/screens/{phòng}/{mã}`: ảnh khung mới nhất, `Cache-Control: no-store`, `nosniff`; mã sai / đã tắt → 404. Ai có link (chỉ người trong phòng nhận) xem được — như link presigned.
- Markdown: nội dung đi **trong** `ScreenDto { kind: Markdown, markdown, url: "", live: true }` (không URL, không lưu); tiêu đề = `title` hoặc "<tên bot> đang trình bày". FE dùng `Markdown` chung với `noImages` (ảnh nhúng chỉ hiện chữ thay thế → máy người xem không tải URL lạ), nền theo theme app.
- Tắt: `stop_presenting`; bot `go_to` chỗ khác (dọn ngay trong `bot-move`); bot offline; 10 phút không khung mới (`BotSweeper` 15 s); màn hình bị người khác thay. Người trong phòng bấm **Tắt chiếu** (`ClearScreen` → `MarkCleared`) → bot không bật lại trong **1 phút** (409).
- FE: `ScreenDocPanel` hiện nhãn **● Trực tiếp** + giờ cập nhật; `LiveImage` tải khung mới ngầm rồi mới thay (không nháy).
- nginx `location = /mcp` thêm `client_max_body_size 4m` (ảnh base64 ~2,7 MB; mặc định 1 MB → 413).

## Kiểm tra

Unit `tests/OfficeHub.Realtime.Tests/BotScreensTests.cs`. E2E `scripts/dev/bot-screen-e2e.ts` (28 kiểm tra, gồm 8 của present_markdown — 2026-11-12, ~1,5 phút; Api + Realtime + Mcp, người xem đi bộ vào phòng bằng `navGrid.ts`). Chưa e2e `present_document` (cần tài liệu thật trên S3) — dùng lại `RoomScreens.Parse` đã có test.
