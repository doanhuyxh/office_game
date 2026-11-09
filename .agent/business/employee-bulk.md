# Thao tác hàng loạt trên danh sách nhân viên (HR)

> Về [organization.md](organization.md). Code: BE `Features/Employees/BulkEndpoints.cs` + `Domain/EmployeeBulk.cs` (module Organization); FE `features/employees/components/{bulk-action-bar,bulk-update-dialog,bulk-resign-dialog}` + cột tích chọn trong `employee-table`. Test: `EmployeeBulkTests`, e2e `scripts/dev/employees-bulk-e2e.ts` (DB tạm).

## API (`/api/org/employees`, chỉ `AuthPolicies.Hr`)

| Endpoint | Body / query | Quy tắc |
|---|---|---|
| `POST /bulk/update` | `ids[]`, `setDepartment` + `departmentId`, `setPosition` + `positionId`, `setManager` + `managerId` | Chỉ trường có `set* = true` mới đổi; giá trị `null` = bỏ trống. Không id / > `EmployeeBulk.MaxIds` (1000) / không tích mục nào / id không tồn tại → 400. Phòng ban / chức vụ không tồn tại → 400. Quản lý: phải còn làm; `EmployeeBulk.CreatesCycle` → 400 nếu quản lý nằm trong nhóm hoặc đang là cấp dưới (trực tiếp / gián tiếp) của người trong nhóm. Ghi qua entity được theo dõi → `[Audited]` ghi từng người. Trả `{ affected }` |
| `POST /bulk/resign` | `ids[]`, `leftAt` | Như "Nghỉ việc" từng người: `Resigned` + `LeftAt`, gỡ `ManagerId` của cấp dưới + `HeadEmployeeId` phòng ban, khoá tài khoản (sau commit). Người đã nghỉ bị bỏ qua (không lỗi). Có người `leftAt < joinedAt` → 400 nêu mã, **không ai** bị đổi. Một transaction |
| `GET /export` | `ids=a,b,…` **hoặc** bộ lọc danh bạ (`search`, `departmentId`, `includeResigned`) | Excel 1 sheet "Nhân viên" (`EmployeeBulk.ExportHeader`: mã, họ tên, email, SĐT, ngày sinh, phòng ban, chức vụ, chức danh, mã + tên quản lý, trạng thái, ngày vào / nghỉ, tài khoản). Ô chữ định dạng `@` để SĐT giữ số 0 đầu. `ids` sai định dạng → 400 |

## Giao diện

- Chỉ HR (`canEdit`) thấy cột tích chọn. Ô tiêu đề = **chọn cả trang** (có trạng thái "một phần").
- Đã chọn hết trang mà bộ lọc còn nhiều hơn → link "Chọn tất cả N nhân viên khớp bộ lọc" (tải cả danh sách qua `employeesApi.list(filter)`). Khi đó Xuất Excel gửi bộ lọc thay vì id (tránh URL dài).
- Lựa chọn gắn với bộ lọc: đổi tìm kiếm / phòng ban / "Hiện người đã nghỉ" là bỏ chọn; chuyển trang thì giữ.
- Thanh thao tác: Đổi phòng ban / quản lý / chức vụ (tích mục cần đổi, "— Không —" = bỏ trống) · Xuất Excel · Nghỉ việc (liệt kê người bị ảnh hưởng, phải gõ đúng số người để xác nhận) · Bỏ chọn.
