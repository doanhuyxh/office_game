# Hợp đồng lao động (module LaborContracts)

> Nguồn sự thật là code (`backend/src/Modules/LaborContracts/`, `frontend/src/features/contracts/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md). Schema `contracts`: [database-workflow.md](../database-workflow.md).

## Quyết định (chủ dự án chốt 2026-11-05)

| Câu hỏi | Quyết định |
|---|---|
| Ai xem | **HR / admin**: mọi hợp đồng, thêm / sửa / chấm dứt / xoá, phụ lục, file. **Nhân viên**: chỉ xem (kể cả lương, file) hợp đồng của chính mình. **Quản lý không** xem hợp đồng cấp dưới |
| Lương | Lưu lương cơ bản + phụ cấp, **mã hoá AES-256-GCM** (`IFieldEncryptor`, khoá `Encryption__Key`). Mất / đổi khoá = mất lương đã lưu |
| Nhắc hết hạn | **30 và 7 ngày** trước ngày kết thúc, gửi **HR** (không có HR → admin) + **quản lý trực tiếp** (email + chuông). Hợp đồng thử việc cũng nhắc |

## Quy tắc (`Domain/ContractRules.cs`, test `tests/OfficeHub.Modules.LaborContracts.Tests`)

| Loại (`Type`) | Ngày kết thúc |
|---|---|
| `Indefinite` (không xác định thời hạn) | phải trống → `"Hợp đồng không xác định thời hạn không có ngày kết thúc"` |
| `Fixed` (xác định thời hạn) | bắt buộc, sau ngày bắt đầu, `< start + 36 tháng` → `"… tối đa 36 tháng"` |
| `Probation` (thử việc) | bắt buộc, ≤ **180 ngày** tính cả ngày đầu → `"Thời gian thử việc tối đa 180 ngày"` |

- **Trạng thái** (tính lúc đọc): có `TerminatedOn` → `Terminated`; `StartDate > hôm nay` → `Upcoming`; `EndDate < hôm nay` → `Expired`; còn lại `Active`. `daysLeft` chỉ có khi `Active` và có ngày kết thúc. Ngày cuối tính theo `EffectiveEnd` = min(ngày kết thúc, ngày chấm dứt).
- **Số hợp đồng** duy nhất trong các hợp đồng chưa xoá → `"Số hợp đồng đã tồn tại"`.
- **Không trùng thời gian** giữa các hợp đồng (chưa xoá) của cùng nhân viên (theo `EffectiveEnd`) → `"Trùng thời gian với hợp đồng X (…)"`. Ký hợp đồng mới ngay hôm sau ngày kết thúc là hợp lệ.
- **Phụ lục** (BLLĐ 2019 Điều 22): **không** đổi thời hạn; có số (duy nhất trong hợp đồng), ngày hiệu lực **trong thời hạn** hợp đồng, nội dung, lương / phụ cấp mới (trống = không đổi). Lương hiện tại = phụ lục mới nhất có đổi giá trị và hiệu lực ≤ hôm nay, không có thì lương trên hợp đồng (`EffectiveValue`).
- **Chấm dứt** (`/terminate`): ngày làm việc cuối trong `[StartDate, EndDate]`, lý do bắt buộc; đã chấm dứt → 409. Hết hạn tự nhiên thì không cần chấm dứt.
- **Xoá** = xoá mềm (`DeletedAt`), chỉ dùng khi nhập nhầm; file S3 giữ lại. Xoá phụ lục = xoá cứng.
- Sửa hợp đồng đổi `EndDate` → xoá cờ đã nhắc để nhắc lại theo hạn mới.
- Không tự đổi trạng thái nhân viên (thử việc → chính thức) khi thêm hợp đồng.

## Nhắc sắp hết hạn (`Infrastructure/ContractReminderJob.cs`)

`BackgroundService` trong Api: chạy 30 giây sau khởi động rồi **mỗi giờ**. Hợp đồng chưa chấm dứt có `EndDate` trong `[hôm nay, hôm nay + 30]`, nhân viên còn làm → `DueReminder`: còn ≤ 7 ngày & chưa nhắc 7 → nhắc 7 (đặt cả cờ 30); còn 8–30 ngày & chưa nhắc 30 → nhắc 30. Người nhận bỏ chính nhân viên đó. `Category = contract_expiring`, link `/contracts`. Giả định một instance Api.

## Endpoint (`/api/contracts`, đăng nhập)

| Method | Path | Quyền |
|---|---|---|
| GET | `/` (`?employeeId=&status=`) | HR |
| GET | `/my` | nhân viên (không có hồ sơ → 409 `no_employee_profile`) |
| GET | `/{id}` | HR hoặc chủ hợp đồng; khác → 403 `"Bạn không có quyền xem hợp đồng này"` |
| POST / PUT | `/`, `/{id}` | HR — `{ employeeId, number, type, signedDate?, startDate, endDate?, jobTitle?, salary?, allowance?, note? }` |
| POST | `/{id}/terminate` | HR — `{ terminatedOn, reason }` |
| DELETE | `/{id}` | HR (xoá mềm) |
| POST / DELETE | `/{id}/amendments`, `/{id}/amendments/{aid}` | HR — `{ number, effectiveDate, content, salary?, allowance? }` |
| POST | `/{id}/file`, `/{id}/amendments/{aid}/file` | HR — multipart field `file`, PDF / JPG / PNG ≤ 10 MB (`DisableAntiforgery`, dựa SameSite=Lax) |
| GET | `/{id}/file`, `/{id}/amendments/{aid}/file` | HR hoặc chủ → `{ url, name }` presigned (`S3__PresignMinutes`) |

File lưu `contracts/{employeeId}/{contractId}[/amendments/{aid}]/{uuid}.{ext}` (trong `{S3__KeyPrefix}files/`). Thay file: tải file mới trước, rồi xoá file cũ (best effort). Lương trả về đã giải mã; lưu dạng `v1:base64(nonce|cipher|tag)`.

## UI (`frontend/src/features/contracts/`)

- Menu "Hợp đồng" hiện cho mọi người. HR: tab **Tất cả hợp đồng** (cảnh báo nhân viên đang làm chưa có hợp đồng hiệu lực, tìm kiếm, lọc Tất cả / Đang hiệu lực / Sắp hết hạn ≤ 30 ngày / Hết hạn – chấm dứt, menu dòng: xem / sửa / chấm dứt / xoá) + tab **Của tôi**. Nhân viên: thẻ hợp đồng của mình (chỉ xem, tải file).
- `ContractFormDialog` (thêm / sửa), `ContractDetails` (thông tin, lương hiện tại, phụ lục, file — `canEdit` cho HR), `TerminateDialog`, `AmendmentDialog`. Upload qua `httpUpload` (`services/api-client.ts`).

**Chưa có:** mẫu hợp đồng / sinh file, ký điện tử, lịch sử sửa (audit), nhắc hợp đồng thử việc chuyển chính thức, liên kết lương với quy ra tiền phép / tăng ca.
