# Bot chiếu màn hình / tài liệu lên TV phòng họp

> Phần tiếp của [office-bots.md](office-bots.md) (đi lại `go_to`). Code: `OfficeHub.Realtime/Screens/BotScreens.cs`, `Hubs/BotScreenEndpoints.cs`, `Mcp/Tools/OfficeTools.cs` (`present_*`), FE `features/office/components/live-image`, `office-docs` (`ScreenDocPanel`). Chiếu tài liệu của người: [office-documents.md](office-documents.md).

Chủ dự án chọn 2026-11-11 **cách 1 — ảnh chụp màn hình cập nhật** (không phải video LiveKit). Mức tôi tự chọn (chưa chốt riêng): ≤ 1 ảnh / 3 giây; chỉ người trong phòng xem; ảnh **chỉ trong RAM** (khung mới nhất), không S3.

## Tool MCP (chỉ tài khoản bot)

| Tool | Việc |
|---|---|
| `present_screen(uploadId, caption?, source?)` | Ảnh chụp màn hình agent → TV phòng bot đang ở. **Không base64** (TEST-154): `create_upload(target = screen)` → agent `curl` PUT S3 → `present_screen(uploadId)`; hoặc chiếu lại ảnh đã gửi: id tệp đính kèm + `source = chat` / `task-comment`. Gọi lại = khung mới |
| `present_markdown(content, title?)` | Trang Markdown (GFM: tiêu đề, checklist, bảng, code) → TV phòng; **cách trình bày chính** (2026-11-12): mỗi lần vài trăm token, còn ảnh base64 thì mô hình phải tự sinh hàng chục nghìn token nên thực tế agent chỉ gửi được 1 khung. Gọi lại = thay cả trang, ≥ 1 giây / lần, ≤ 20.000 ký tự (bỏ ký tự điều khiển). Bong bóng `📝 Đang trình bày` |
| `present_document(document)` | Tài liệu trong kho (id / TL-… / số hiệu): Mcp gọi Api bằng token bot `GET /api/documents/assets/{id}` + `/file?present=true` (Api kiểm quyền + ghi nhật ký xem) → Realtime `RoomScreens.Parse` |
| `stop_presenting()` | Tắt màn hình bot ở phòng mình |

### Ảnh từ S3 (TEST-154)

Chủ dự án chốt 2026-11-17: không truyền / lưu base64 qua tool (model phải tự sinh cả chuỗi — rất tốn token đầu ra), chỉ dùng file trên S3. Không giữ tương thích tham số `image` cũ (chỉ bot nội bộ dùng).
- `create_upload(target = screen, fileName, size)` — chỉ bot; đuôi `.png` / `.jpg` / `.jpeg` / `.webp` (sai → lỗi trước khi xin vé). Mcp xin **vé chat của chính bot** (`POST /api/chat/uploads`, gắn tạm kênh `office` — hội thoại bot luôn vào được; vé không bao giờ thành tin), nên chung hạn mức 30 tệp / giờ và dọn vé bỏ dở sau 24 giờ như chat ([office-bots.md](office-bots.md#tin-nhắn-của-bot)).
- `present_screen` (`source` trống / `upload`): `GET /api/chat/uploads/{id}/screen` — chỉ vé **của chính người gọi** (khác → 404), chưa PUT → 409, không phải PNG / JPEG / WebP → 400, chữ ký file sai → 400 (`PromoteUploadAsync`), hỏng / quá 40 MP → 422; trả JPEG cạnh dài ≤ `ChatRules.ScreenMaxSide` (1920, `ImageThumbnail`). Mcp gửi khung cho Realtime (base64 chỉ ở chặng nội bộ Mcp → Realtime, giữ `BotScreenRequest`), Realtime nhận OK → `DELETE /api/chat/uploads/{id}` (xoá S3 key chính + tạm + vé). Realtime từ chối (chưa vào phòng, < 3 giây, vừa bị tắt) → vé còn, gọi lại cùng `uploadId` được.
- `source = chat` / `task-comment`: `GET …/attachments/{id}/preview` / `…/comment-attachments/{id}/preview` (quyền như `view_attachment`, JPEG ≤ 1280) — không xoá gì.
- Route token AI: `GET /api/chat/uploads/{guid}/screen`, `DELETE /api/chat/uploads/{guid}` (`AccessTokenAuth.AllowedExact`).

Mcp → Realtime `POST /rt/internal/bot-screen` (`BotScreenRequest { activity, mode: frame | markdown | document | stop, image, caption, markdown, detailJson, fileJson }`, khoá `Chat__InternalKey`). Bong bóng trên đầu bot: `🖥 Đang chiếu màn hình` (không lặp ảnh).

## Quy tắc (Realtime)

- Bot phải **đã tới** một phòng có tường (`Bot.Spot.RoomId`, hết đường đi) → không thì 409 "go_to phòng họp trước". Người thật của tài khoản đang trong 3D → 409.
- Ảnh: nhận diện bằng chữ ký file (`DetectImage`, không tin tên / content-type), sai → 400; kiểm ảnh **trước** tần suất; < 3 giây từ khung trước → 429.
- Khung lưu ở `BotPresentation` (theo phòng, mã ngẫu nhiên 128 bit); `ScreenDto { assetId: "bot:<userId>", kind: Image, url: /rt/screens/{phòng}/{mã}?v={số khung}, live: true }` → `RoomScreens.Set` + `ScreenChanged` cho người đang trong phòng (như `PinScreen`). Bot khác chiếu ở cùng phòng → thay (mã mới).
- `GET /rt/screens/{phòng}/{mã}`: ảnh khung mới nhất, `Cache-Control: no-store`, `nosniff`. Chỉ người **đăng nhập (cookie) đang đứng trong phòng đó** (TEST-18): chưa đăng nhập → 401; ngoài phòng / mã sai / đã tắt → 404. Người trong phòng bấm Tắt chiếu hoặc chiếu tài liệu đè → `BotScreens.End` ngay (link cũ 404, không đợi `BotSweeper`). Kiểm tần suất + ghi khung nằm trong `lock` (2 lệnh song song không cùng lọt).
- Markdown: nội dung đi **trong** `ScreenDto { kind: Markdown, markdown, url: "", live: true }` (không URL, không lưu); tiêu đề = `title` hoặc "<tên bot> đang trình bày". FE dùng `Markdown` chung với `noImages` (ảnh nhúng chỉ hiện chữ thay thế → máy người xem không tải URL lạ), nền theo theme app.
- Tắt: `stop_presenting`; bot `go_to` chỗ khác (dọn ngay trong `bot-move`); bot offline; 10 phút không khung mới (`BotSweeper` 15 s); màn hình bị người khác thay. Người trong phòng bấm **Tắt chiếu** (`ClearScreen` → `MarkCleared`) → bot không bật lại trong **1 phút** (409).
- FE: `ScreenDocPanel` hiện nhãn **● Trực tiếp** + giờ cập nhật; `LiveImage` tải khung mới ngầm rồi mới thay (không nháy).
- nginx `location = /mcp` thêm `client_max_body_size 4m` (thời ảnh base64; từ TEST-154 request tool nhỏ, giữ không hại).

## Kiểm tra

Unit `tests/OfficeHub.Realtime.Tests/BotScreensTests.cs`. Unit TEST-154: `OfficeHub.Mcp.Tests/PresentScreenUploadTests.cs`, `AccessTokenScopeTests`, `ChatBotRulesTests.Screen_frames_are_png_jpeg_webp_only`. E2E `scripts/dev/bot-screen-e2e.ts` (41/41 — 2026-11-17, TEST-154 luồng `create_upload screen` → PUT → `uploadId`; ~1,5 phút; Api + Realtime + Mcp + **S3 tạm** RustFS, người xem đi bộ vào phòng bằng `navGrid.ts`). Chưa e2e `present_document` (cần tài liệu thật trên S3) — dùng lại `RoomScreens.Parse` đã có test.
