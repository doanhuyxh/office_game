# Hồ sơ cá nhân (module Organization, `Features/Profile`)

Chủ dự án chốt 2026-11-06. Về [organization.md](organization.md).

| Nhóm | Trường (`Employee`) | Ai sửa |
|---|---|---|
| Liên hệ | `Phone`, `CurrentAddress`, `PermanentAddress`, `EmergencyContactName/Relation/Phone` | **Nhân viên tự sửa, hiệu lực ngay** (+ HR) |
| Ảnh đại diện | `AvatarKey` (S3 `employees/{id}/avatar/{uuid}.{ext}`, JPG/PNG/WebP ≤ 2 MB) | Nhân viên |
| Cần duyệt | `DateOfBirth`, `IdNumberEncrypted` (CCCD 12 số), `IdIssuedOn`, `IdIssuedPlace`, `BankName`, `BankAccountEncrypted` (6–20 số), `BankAccountHolder` (viết HOA) | Nhân viên **gửi yêu cầu → HR duyệt**; HR sửa thẳng |
| Email | `Email` | **Chỉ HR** (form hồ sơ nhân viên) — gắn đăng nhập + OTP ký điện tử |

- CCCD / số tài khoản mã hoá AES-GCM (`IFieldEncryptor`, `Encryption__Key`); lịch sử sửa tự che (tên cột kết thúc `Encrypted`). Quy tắc thuần: `Domain/PersonalProfile.cs` (`Validate`, `Normalize` — bỏ ký tự không phải số, chủ TK viết hoa; `Mask`), test `PersonalProfileTests`.
- Yêu cầu: bảng `org.profile_change_requests` [Audited] (`DataEncrypted` = JSON `SensitiveChange`: null = không đổi, `""` = xoá). Mỗi nhân viên tối đa 1 Pending (409). Không đổi gì / giống hiện tại → 400. Duyệt: áp vào hồ sơ; từ chối: bắt buộc lý do. Chuông: `profile_change_requested` (HR) · `profile_change_approved` / `rejected` (nhân viên), không email.
- Danh bạ: điện thoại hiện cho mọi người; địa chỉ, liên hệ khẩn cấp, CCCD, ngân hàng **không** có trong `/api/org/employees`. `EmployeeListItem.avatarUrl`.

## API `/api/org/profile` — CỐ Ý ngoài allowlist token AI (`AccessTokenAuth`): CCCD / ngân hàng không bao giờ ra MCP

| Method | Path | Quyền |
|---|---|---|
| GET | `/me` | chính chủ → `MyProfileDto` (công việc chỉ xem, `contact`, `sensitive` giải mã, `pending`, `lastDecided`); 404 `no_employee_profile` |
| PUT | `/me/contact` | chính chủ (validate SĐT, độ dài) |
| POST / DELETE | `/me/avatar` | chính chủ (multipart `file`; ảnh cũ xoá best-effort) |
| POST | `/me/requests` | `{ change: SensitiveChange, note }` |
| DELETE | `/me/requests/{id}` | huỷ yêu cầu Pending của mình |
| GET | `/avatars/{employeeId}?v=` | đăng nhập → 302 link S3 15 phút (`v` đổi khi đổi ảnh; pipeline đặt no-store nên không cache) |
| GET | `/requests?status=` | HR (mặc định Pending), kèm diff cũ → mới |
| POST | `/requests/{id}/approve`, `/requests/{id}/reject` `{ reason }` | HR |
| GET / PUT | `/employees/{id}` | HR — xem / sửa thẳng (`{ contact, sensitive }`, thay toàn bộ, null = xoá) |

## Dùng ở module khác (qua `IEmployeeDirectory`)

- `GetProfileAsync` thêm CCCD (giải mã), ngày / nơi cấp, địa chỉ → mẫu hợp đồng có `{{SoCCCD}}`, `{{NgayCapCCCD}}`, `{{NoiCapCCCD}}`, `{{DiaChiThuongTru}}`, `{{DiaChiHienTai}}`.
- `GetBankAccountsAsync(ids)` → Excel bảng lương có sheet **"Chuyển khoản"** (ngân hàng, số TK dạng chữ, chủ TK, thực lĩnh, nội dung; dòng đỏ "CHƯA KHAI TÀI KHOẢN").

## UI

- `/profile` (`features/profile`, menu tài khoản Header + sidebar "Hồ sơ cá nhân", ẩn với tài khoản không có hồ sơ): ảnh + thông tin công việc (chỉ xem), form Liên hệ, thẻ "Thông tin cần HR duyệt" (số che 4 số cuối, nút Hiện số; dialog "Đề nghị cập nhật" chỉ gửi trường đã đổi; yêu cầu đang chờ + huỷ; kết quả lần trước / lý do từ chối).
- HR: trang Nhân viên → tab **Yêu cầu cập nhật** (badge số chờ) duyệt / từ chối; menu ⋯ dòng nhân viên → "Thông tin cá nhân (CCCD, ngân hàng…)" (`EmployeePrivateDialog`).
- `components/common/PersonAvatar.tsx` (ảnh hoặc chữ viết tắt): Header, sidebar, danh bạ, sơ đồ tổ chức.

E2E: `scripts/dev/profile-e2e.ts` (DB tạm; ảnh lên S3 thật rồi tự xoá).
