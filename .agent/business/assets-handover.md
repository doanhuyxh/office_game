# Tài sản — khấu hao, biên bản giao nhận, ảnh / hoá đơn thiết bị (module Assets)

> Nguồn sự thật là code: `backend/src/Modules/Assets/` (`Domain/AssetRules.cs`, `Features/HandoverEndpoints.cs`, `Features/AttachmentEndpoints.cs`,
> `Infrastructure/HandoverDocument.cs`); FE `features/assets/components/{handover-list,handover-template-card,device-attachments}`. Phần lõi: [assets.md](assets.md).
> Chủ dự án mở lại 2026-11-09 (trước đó chốt "chỉ giá mua, không biên bản"). Migration `AssetsDepreciationHandover`.

## Khấu hao (chỉ HR thấy, tính khi đọc — không ghi sổ Finance)

- **Đường thẳng theo tháng**, không giá trị thu hồi: mỗi **tháng trọn vẹn** kể từ ngày mua trừ `giá mua / số tháng` (làm tròn đồng); hết số tháng → còn 0.
  Ngày mua cuối tháng: 31/01 → 28/02 tính đủ 1 tháng (`AssetRules.FullMonthsBetween`).
- Số tháng: `categories.DepreciationMonths` (mặc định MT / MH / KH 36, DT / PK 24 — seed + migration đặt cho loại có sẵn; HR sửa ở Danh mục; trống / 0 = không khấu hao)
  hoặc riêng thiết bị `devices.DepreciationMonths` (null = theo loại, **0 = không khấu hao**). Tối đa 600.
- Thiếu giá mua hoặc ngày mua → không tính (null). **Thanh lý / Mất → giá trị còn lại 0.**
- Hiện ở: `DeviceDto` (`effectiveDepreciationMonths`, `monthsUsed`, `accumulatedDepreciation`, `bookValue`), chi tiết thiết bị, Tổng quan
  (`totalBookValue` — thiết bị chưa thanh lý / mất), Excel thiết bị (số tháng, đã khấu hao, giá trị còn lại tại hôm nay).

## Biên bản giao nhận (`handover_records`, chỉ thêm, không xoá)

- **Cấp** thiết bị → biên bản `Assign`; **thu hồi** (nút Thu hồi) → biên bản `Return`. Đánh dấu Mất / kiểm kê không lập biên bản.
- Số `BB-{năm}-{00001}` (bộ đếm `handover:{năm}` trong `sequences`). **Chụp** thông tin lúc lập: nhân viên (mã, tên, phòng ban), thiết bị (mã, tên, loại,
  hãng, model, serial), ghi chú lúc giao / trả (ô ghi chú cấp / thu hồi = "tình trạng, phụ kiện kèm theo"), người lập.
- `RequiresConfirmation` = nhân viên còn làm **và** có tài khoản lúc lập (người đã nghỉ → không chờ).
- **Xác nhận**: chính nhân viên trong biên bản bấm "Xác nhận" ở Tài sản → Của tôi → ghi `ConfirmedAt` + `ConfirmedIp`. Người khác (kể cả HR / admin) → 404;
  đã xác nhận / không cần → 409. Không chặn việc cấp / thu hồi.
- Thông báo cấp (`asset_assigned`, chuông + email) và thu hồi (`asset_returned`, chuông) ghi số biên bản cần xác nhận. Job `AssetsMaintenanceJob` nhắc **một lần**
  (`RemindedAt`, `asset_assigned`, chuông + email) khi quá **3 ngày** chưa xác nhận.
- **Word**: `GET /handovers/{id}/docx` (HR hoặc chính nhân viên) — mẫu riêng của công ty nếu có, không thì mẫu mặc định sinh bằng code (A4, có chỗ ký 2 bên).
  Trường `{{SoBienBan}} {{LoaiBienBan}} {{NgayLap}} {{GioLap}} {{NguoiLap}} {{MaNhanVien}} {{NhanVien}} {{PhongBan}} {{MaThietBi}} {{TenThietBi}} {{LoaiThietBi}}
  {{Hang}} {{Model}} {{SoSerial}} {{GhiChu}} {{XacNhan}}` (giờ theo `Office__TimeZone`; `XacNhan` = "Đã xác nhận trên OfficeHub lúc … (IP …)" / "Chưa xác nhận").
- **Mẫu riêng** (HR, Danh mục → Mẫu biên bản): `assets.settings` (một dòng: `HandoverTemplateKey/Name`), file ở S3 `assets/templates/`. Kiểm tra mở được + có ≥ 1 trường;
  bỏ mẫu riêng = về mặc định (file cũ giữ trên S3). Mẫu hỏng lúc xuất → 409.

## Ảnh / hoá đơn thiết bị (`device_attachments`, chỉ HR)

Giống chứng từ Finance ([finance-docs.md](finance-docs.md)): `POST /devices/{id}/attachments { kind, fileName, contentType?, size }` → dòng chờ + presigned PUT 15 phút
(S3 `assets/devices/{thiết bị}/{id}/{tên an toàn}`) → trình duyệt PUT → `POST /attachments/{id}/confirm` (HEAD S3; chưa có → 409; > 20 MB → xoá file + 400; chỉ người xin link).
`kind`: `Photo` (png / jpg / webp / heic), `Invoice` (+ pdf, xml hoá đơn điện tử, zip), `Other` (+ Word, Excel, txt). ≤ 20 MB, ≤ 30 tệp / thiết bị; dòng chờ > 1 ngày tự dọn.
Đọc `GET /devices/{id}/attachments`, `GET /attachments/{id}/url[?download=true]` (10 phút; ảnh / PDF xem trong trình duyệt). Xoá = ẩn (`DeletedAt`), file giữ lại.
Thiết bị thanh lý / mất vẫn thêm được (lưu chứng từ thanh lý). `DeviceDetailDto.attachmentCount`.

## Endpoint mới (`/api/assets`)

| Method | Path | Ai |
|---|---|---|
| GET | `/handovers/my` | mọi người (biên bản của mình, chờ xác nhận lên đầu) |
| POST | `/handovers/{id}/confirm` | chính nhân viên trong biên bản |
| GET | `/handovers/{id}/docx` | HR hoặc chính nhân viên |
| GET | `/handovers?unconfirmed=true` | HR (200 gần nhất) |
| GET | `/settings` · `/settings/handover-template/fields` · `/settings/handover-template/default` | HR |
| POST / DELETE | `/settings/handover-template` (multipart `file`) | HR |
| GET / POST | `/devices/{id}/attachments` · POST `/attachments/{id}/confirm` · GET `/attachments/{id}/url` · DELETE `/attachments/{id}` | HR |

Token AI: ngoài allowlist (chỉ `/my` + `/employees/{id}/holdings`) → 403. Tool MCP không đổi.

## UI

Chi tiết thiết bị: khấu hao + giá trị còn lại, khối "Ảnh & hoá đơn", "Biên bản giao nhận" (tải Word). Form thiết bị: "Số tháng khấu hao" (trống = theo loại).
Danh mục: cột Khấu hao, thẻ "Mẫu biên bản giao nhận". Tổng quan: giá trị còn lại, số + danh sách biên bản chờ xác nhận. Của tôi: khung "Biên bản cần bạn xác nhận".

## Test

`AssetRules` khấu hao / tệp / biên bản: `tests/OfficeHub.Modules.Assets.Tests/DepreciationHandoverTests.cs`. E2E `scripts/dev/assets-handover-e2e.ts` (62 kiểm tra, đạt 2026-11-09, chạy từ `frontend/`).
