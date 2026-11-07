# Kho tài liệu — tài sản số (module Documents)

> Nguồn sự thật là code (`backend/src/Modules/Documents/`, `frontend/src/features/documents/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md). Schema `documents`: [database-workflow.md](../database-workflow.md#schema-documents--documentsdbcontext-migration-initialdocuments).

Video, ảnh, văn bản công việc là **tài sản của công ty**: mỗi file có mã, kho chủ quản, loại, người phụ trách, phiên bản, nhật ký truy cập, hạn lưu trữ. Chủ dự án chốt 2026-11-07: kho theo **phòng ban + dự án** (+ kho chung công ty), file tải **thẳng lên S3** bằng presigned URL, xem trước bằng link presigned; **ai cũng tạo được tài liệu**; mức bảo mật cao hơn "Nội bộ" để sẵn, chưa mở; làm giai đoạn 1 (kho) + 2 (ban hành, vòng đời).

## Kho + quyền (`Infrastructure/DocumentAccess.cs` — mọi kiểm tra quyền đi qua đây)

| Kho (`SpaceKind`) | Đọc / ghi | Quản lý kho |
|---|---|---|
| `Company` (SpaceId null, mã `CTY`) | Mọi người | HR / admin |
| `Department` (SpaceId = Id phòng, mã = mã phòng) | Phòng mình + các phòng cha; trưởng phòng thêm mọi phòng con | Trưởng phòng (+ phòng con), HR |
| `Project` (SpaceId = Id dự án, mã = mã dự án) | Thành viên; dự án `Closed` → chỉ đọc | Quản lý dự án (`ProjectRole.Manager`), HR |

- HR / admin: toàn quyền mọi kho. "Quản lý kho" = xoá / sửa thư mục và tài liệu của người khác, đổi người phụ trách, lưu trữ, xem nhật ký truy cập. Người tạo / người phụ trách (`IsOwner`) có các quyền này trên tài liệu của mình.
- `Classification`: chỉ dùng `Internal`; `Restricted` / `Confidential` → hiện chỉ HR xem (`CanView`), API chưa cho đặt. Mở rộng sau: sửa `CanView` + thêm danh sách người được xem.
- Người duyệt ban hành (quản lý trực tiếp của người gửi) xem được tài liệu khi đang `PendingApproval` dù không thuộc kho. Tài liệu trong thùng rác: chỉ chủ / người quản lý kho.
- Token AI bị chặn (không có trong `AccessTokenAuth.IsAllowed`) — chưa có tool MCP (giai đoạn 3).

## Tải lên (thẳng S3, không qua Api)

1. `POST /uploads { fileName, contentType, size }` → vé `{ ticketId, url, contentType, expiresAt }`. Chặn file thực thi (`.exe .bat .apk .sh .dll…`), tối đa **5 GB** (giới hạn PUT đơn của S3). Key: `documents/{yyyy}/{MM}/{ticketId}/{tên-không-dấu}`.
2. Trình duyệt `PUT url` với header `Content-Type` đúng như vé (XHR có % tiến độ). **Bucket phải bật CORS** cho PUT từ domain app — xem [env.md](../env.md#s3-cors-kho-tài-liệu).
3. `POST /assets { ticketId, spaceKind, spaceId, folderId?, docTypeId?, title?, description?, tags? }` → Api HEAD S3 kiểm tra file có thật (chưa có → 409), vé chỉ dùng một lần và chỉ của chính người xin. Loại mặc định theo nhóm file: ảnh → `HA`, video → `VD`, còn lại → `VB`; tiêu đề mặc định = tên file bỏ đuôi.
- Nhập cả thư mục (chọn / kéo thả): FE gọi `POST /folders/ensure { path: "a/b/c" }` **tuần tự** cho từng thư mục rồi tải 3 file song song (`UploadQueue.tsx`).
- Vé quá 24 giờ chưa dùng → job xoá file rác trên S3.

## Tài sản (`assets`) + vòng đời

- Mã `TL-{kho}-{năm}-{00001}` (bộ đếm theo năm, toàn công ty). Người phụ trách mặc định = người tạo.
- `Draft` → gửi duyệt (`POST /assets/{id}/submit`, cần hồ sơ nhân viên; luồng duyệt `document_publish`, bước `[Manager]` — không có quản lý thì HR) → `PendingApproval` → duyệt: `Published` + số hiệu `{stt:000}/{năm}/{mã loại}-{mã kho}` (bộ đếm theo loại + kho + năm), `PublishedAt`, hạn lưu trữ tính lại từ ngày ban hành; từ chối / huỷ đơn → về `Draft` (giữ `RejectReason`). Handler idempotent. Người gửi lưu ở `SubmittedByEmployeeId` (có thể là trưởng phòng gửi giúp).
- **Ai duyệt** (`GET /assets/{id}/approvers` → khung "Ai duyệt tài liệu này" trong chi tiết, kèm email): nháp → tính theo người đang xem; đang chờ → theo người đã gửi. `Self` = chức vụ người gửi bật **tự ban hành** (`org.positions.SelfPublishDocuments`, chỉ cấp 1–6 = Chuyên viên trở lên; HR bật ở tab Chức vụ) → nút "Ban hành ngay", `submit` ban hành luôn không tạo đơn; `Manager` = quản lý trực tiếp còn làm (admin duyệt thay được); `Hr` = HR trừ người gửi (không còn → admin) + lý do (chưa có / quản lý đã nghỉ); `None` = không gửi được (chưa có hồ sơ).
- Chỉ `Draft` được thay file (phiên bản mới, bản cũ giữ trên S3), đổi loại, chuyển thùng rác. `Published` → `Archived` (lưu trữ, chỉ đọc). Sửa tiêu đề / mô tả / thẻ / thư mục: mọi trạng thái trừ `Destroyed`.
- **Thùng rác**: xoá mềm (`DeletedAt`), khôi phục hoặc xoá hẳn (xoá S3 + hồ sơ); quá **30 ngày** job xoá hẳn.
- **Hạn lưu trữ**: `RetentionUntil` = ngày (tạo / ban hành) + `DocType.RetentionYears` (null = vĩnh viễn). Job nhắc HR + người phụ trách một lần khi còn ≤ 30 ngày (`document_retention`). HR: đổi hạn (`PUT /admin/assets/{id}/retention`) hoặc **huỷ** (`POST /admin/assets/{id}/destroy { reason }` bắt buộc lý do): xoá file mọi phiên bản, giữ hồ sơ làm biên bản → `Destroyed`.
- **Xem / tải**: `GET /assets/{id}/file?version=&download=` → presigned GET kèm `Content-Disposition` (inline cho ảnh / video / âm thanh / PDF / text, còn lại attachment; tên UTF-8). Link video / âm thanh 3 giờ, loại khác 15 phút. Mỗi lần gọi ghi `access_logs` (Xem / Tải về, IP).
- `[Audited]` trên `Asset`, `Project`, `DocType` → hiện ở "Lịch sử thay đổi".

## Dự án

Tạo: vai trò manager / hr / admin (người tạo có hồ sơ → quản lý dự án). Mã viết hoa, duy nhất. Quản lý dự án / HR: sửa, đóng / mở lại, thêm thành viên (chuông `project_member_added`), bỏ thành viên (phải còn ≥ 1 quản lý). HR xoá dự án chưa có tài liệu (kể cả thùng rác), có rồi thì đóng.

## Quản trị (HR, `/admin/*`)

- `stats`: số lượng / dung lượng theo kho, nhóm file, loại, 12 tháng; đếm sắp hết hạn, thùng rác, "chưa bàn giao" (người phụ trách đã nghỉ việc).
- `orphans` + `handover { fromEmployeeId, toEmployeeId }`: chuyển mọi tài liệu người cũ phụ trách sang người mới + thêm người mới vào các dự án người cũ tham gia (giữ vai trò); báo người nhận (`document_handover`).
- Loại tài liệu (`/doc-types`, HR thêm / sửa): mặc định VB 5 năm, QĐ / QC vĩnh viễn, HĐ / KT / TK 10 năm, BC / HA / VD 5 năm, K 2 năm — **tham khảo**, kế toán nên xác nhận. Đổi số năm chỉ áp dụng tài liệu mới.

## Job (`DocumentsMaintenanceJob`, mỗi giờ, host Api)

Nhắc hạn lưu trữ · xoá hẳn thùng rác > 30 ngày · dọn vé tải lên > 24 giờ (xoá file S3).

## UI (`/documents`, menu Công việc → "Tài liệu", mọi vai trò)

- Tab **Kho tài liệu**: chọn kho, cây thư mục, đường dẫn, thư mục con (đổi tên / xoá thư mục trống), bảng tài liệu phân trang, tìm (tiêu đề, mã, số hiệu, thẻ, tên file) trong kho hoặc **mọi kho**, lọc nhóm file / trạng thái, nút "Tải file" / "Tải thư mục", kéo thả file hoặc thư mục.
- Sheet chi tiết (`?asset=<id>`, link từ thông báo / thẻ phê duyệt "Xem tài liệu"): xem trước, tải về, gửi duyệt, lưu trữ, xoá / khôi phục / xoá hẳn, sửa thông tin, đổi người phụ trách, phiên bản (+ tải bản mới), nhật ký xem / tải; HR: đổi hạn lưu trữ, huỷ.
- Tab **Dự án** (nút "Dự án mới" trên hàng tab), **Thùng rác**, **Quản trị** (HR: thống kê, đến hạn lưu trữ, bàn giao, loại tài liệu).

E2E: `scripts/dev/documents-e2e.ts` (65 kiểm tra, DB tạm) — [e2e.md](../e2e.md).

Văn phòng 3D (nút HUD, tủ hồ sơ, thư viện, bảng tin `GET /recent`, chiếu lên màn hình phòng `file?present=true`): [office-documents.md](office-documents.md).

**Chưa làm:** trích chữ / OCR, tìm toàn văn tiếng Việt, ảnh thu nhỏ / chuyển mã video, tool MCP cho AI, mức bảo mật Hạn chế / Mật, watermark, upload multipart > 5 GB.
