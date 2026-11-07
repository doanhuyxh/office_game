# Nhập nhân viên từ Excel

> Nguồn sự thật là code: `Modules/Organization/…/Domain/EmployeeImportSheet.cs`, `Features/Employees/ImportEndpoints.cs`, FE `features/employees/components/import-dialog/`. Về [organization.md](organization.md).

Luồng (HR): **Tải file mẫu → chọn file → xem trước (lỗi từng dòng) → Nhập**. Có lỗi ở bất kỳ dòng nào → không nhập dòng nào (transaction). Chỉ tạo **hồ sơ**; cấp tài khoản làm riêng ở từng nhân viên.

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/org/employees/import-template` | `mau-nhap-nhan-vien.xlsx`: sheet "Nhân viên" (tiêu đề + 1 dòng ví dụ, ô định dạng chữ) + "Hướng dẫn" (cột, phòng ban / chức vụ hiện có) |
| POST | `/api/org/employees/import/preview` | multipart `file` (.xlsx ≤ 5 MB) → `{ rows[{ row, code, …, errors[] }], validCount, errorCount, fileError }` |
| POST | `/api/org/employees/import` | Như trên; lỗi → **400 kèm bản xem trước**; đúng → `{ created, codes }` |

- Cột nhận theo **tiêu đề dòng 1** (không phân biệt hoa thường, bỏ dấu, thứ tự tuỳ ý; có alias vd "SĐT", "Mã"): Mã NV, Họ tên*, Email, Điện thoại, Ngày sinh, Phòng ban, Chức vụ (cấp bậc), Chức danh (tự do), Mã quản lý, Ngày vào làm*, Trạng thái, Ghi chú. Thiếu cột bắt buộc / > 500 dòng / không có dòng → `fileError`.
- Ngày: ô kiểu ngày của Excel hoặc chữ `dd/MM/yyyy` (`yyyy-MM-dd` cũng nhận). Dòng trống bỏ qua.
- Tra cứu: phòng ban theo tên hoặc mã; chức vụ theo tên; trạng thái "Thử việc" (mặc định) / "Chính thức". Mã trống → tự cấp tiếp nối mã lớn nhất (không đụng mã đã ghi trong file).
- Kiểm tra: dùng chung `EmployeeEndpoints.ValidateAsync` (trùng mã / email trong hệ thống, email hợp lệ…) + trùng mã / email trong file + mã quản lý phải có trong hệ thống (đang làm) **hoặc trong cùng file** (gán sau khi tạo xong).
- Lịch sử sửa ghi tự động cho mỗi nhân viên được tạo ([audit.md](audit.md)).
