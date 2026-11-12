# Kho tài liệu: mức Hạn chế / Mật, watermark, tài liệu do trợ lý AI tạo (TEST-54)

> Phần mở rộng của [documents.md](documents.md). Code: `Infrastructure/DocumentAccess.cs` (`CanView`), `Features/AssetEndpoints.cs` (FileAsync, ProtectedFileAsync, CreateTextAsync, SubmitAsync), `Domain/PdfWatermark.cs`, font PDF dùng chung `BuildingBlocks/Pdf/PdfFonts.cs`; MCP `OfficeHub.Mcp/Tools/DocumentTools.cs`.

Chủ dự án chốt 2026-11-12: Hạn chế / Mật **chỉ quản trị, HR và người tạo được tải**; watermark ghi **mã nhân viên + thời gian GMT+7** dạng `yyyy/MM/dd-hh:mm` (làm theo 24 giờ: `NV018 2026/11/12-23:05`); tool MCP ban hành **phải do người duyệt**.

## Mức bảo mật (`Asset.Classification`)

| Mức | Ai thấy (chi tiết, danh sách, tìm, file) |
|---|---|
| `Internal` (Nội bộ, mặc định) | như cũ: ai đọc được kho |
| `Restricted` (Hạn chế) · `Confidential` (Mật) | **chỉ admin / HR + người tạo** (`CreatedByUserId`); người duyệt ban hành thêm khi đang chờ duyệt (`CanSeeAsync`). Người khác — kể cả cùng kho, người phụ trách được bàn giao, quản lý kho — nhận **404** (không lộ là có tài liệu) |

- Đặt / đổi mức: `POST /assets` và `PUT /assets/{id}` thêm `classification` (`null` = giữ nguyên; giá trị lạ → 400, kiểm tra **trước** khi nhận vé tải lên). Ai sửa được tài liệu (`CanActAsync`) đổi được mức. FE: ô "Mức bảo mật" trong sheet chi tiết, 🔒 ở bảng + đầu sheet. Hai mức hiện **xử lý giống nhau** (chưa chốt khác biệt Hạn chế ↔ Mật).
- Bảng tin 3D / `GET /recent` chỉ hiện tài liệu Nội bộ (như cũ).

## Mở file tài liệu Hạn chế / Mật

- `GET /assets/{id}/file`: token AI → **403**; `present=true` (chiếu TV phòng họp) → **403** (FE ẩn nút chiếu). File **PDF** → không trả presigned S3 mà trả `url = /api/documents/assets/{id}/protected-file?version=&download=` + `watermarked: true` (xin link không ghi nhật ký). PDF > 100 MB → 413.
- `GET /assets/{id}/protected-file` (cookie; token AI 403; ngoài quyền 404): đọc bản gốc từ S3 vào bộ nhớ, `PdfWatermark.Stamp` mỗi trang một dòng chéo mờ đỏ + chân trang "Tài liệu bảo mật — {mã NV} {giờ}" (mã NV = `Employee.Code`, không có hồ sơ → tên tài khoản), trả `application/pdf` (inline, hoặc attachment kèm tên file khi `download=true`); **mỗi lần gọi ghi `access_logs`** (Xem / Tải về). PDF hỏng / có mật khẩu → 422. Bản gốc trên S3 không đổi.
- File **không phải PDF** (ảnh, Office, video…) chưa đóng dấu được → vẫn presigned bản gốc (`watermarked: false`, ghi nhật ký), FE ghi chú "chưa đóng dấu được (chỉ PDF)". Đóng dấu ảnh / Office cần thêm thư viện — việc riêng trên bảng TEST.
- PDFsharp dùng `GlobalFontSettings.FontResolver` **toàn tiến trình** → font Noto Sans + resolver chuyển từ LaborContracts sang `BuildingBlocks/Pdf/PdfFonts` (ký hợp đồng và đóng dấu tài liệu dùng chung; module mới vẽ PDF gọi `PdfFonts.Ensure()`, không đặt resolver riêng).

## Trợ lý AI ghi tài liệu (MCP)

- `POST /assets/text` `{spaceKind, spaceId, folderId?, docTypeId?, title, format: md|txt|csv, content ≤ 1.000.000 ký tự, description?, tags?}` → Api tự ghi file lên S3 (`documents/{yyyy}/{MM}/{guid}/…`), tạo tài liệu **Nháp, Nội bộ**, phiên bản 1 ghi chú "Tạo qua trợ lý AI" (khi gọi bằng token). Cùng quyền kho như tải lên thường. Web cũng gọi được.
- `POST /assets/{id}/submit` bằng token: **luôn tạo đơn duyệt** (quản lý trực tiếp, không có thì HR) — bỏ qua "tự ban hành" của chức vụ (`SelfPublishDocuments`), trên web vẫn tự ban hành như cũ. Token không bao giờ duyệt đơn (quy tắc chung [agent-team.md](agent-team.md)).
- Token route mở thêm: chỉ `POST /api/documents/assets/text` và `/assets/{id}/submit` (`AccessTokenAuth`, test `AccessTokenScopeTests`). Tải file nhị phân, sửa, xoá, lưu trữ, `protected-file`, nhật ký, quản trị vẫn 403.
- Tool: `create_document`, `submit_document` (tổng 78 tool — [mcp.md](mcp.md)).

## Test

`OfficeHub.Modules.Documents.Tests/DocumentProtectionTests.cs` (dấu, PDF nhiều trang, PDF hỏng), `OfficeHub.Mcp.Tests/AccessTokenScopeTests.cs`; e2e `scripts/dev/documents-extra-e2e.ts` (31 kiểm tra kèm MCP thật khi đặt `MCP_URL`) — [e2e.md](../e2e.md).
