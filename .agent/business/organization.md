# Nhân sự: nhân viên, phòng ban, chức vụ, cấp tài khoản (module Organization)

> Nguồn sự thật là code (`backend/src/Modules/Organization/`, `frontend/src/features/employees/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Mọi route dưới `/api/org` yêu cầu đăng nhập. Ghi = policy `AuthPolicies.Hr` (admin | hr). Schema: [database.md](../database.md#schema-org--orgdbcontext-migration-initialorganization).

## Nhân viên (`Features/Employees/EmployeeEndpoints.cs`)

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/employees?search=&departmentId=&status=&includeResigned=` | đăng nhập | Mặc định ẩn `Resigned`. `search` ILIKE `FullName`/`Code`/`Email`. `account` chỉ trả cho HR |
| GET | `/employees/me` | đăng nhập | 404 nếu tài khoản chưa gắn hồ sơ |
| GET | `/employees/next-code` | HR | `NV` + số lớn nhất + 1, 3 chữ số (`NV001`) |
| GET | `/employees/{id}` | đăng nhập | `account`, `dateOfBirth`, `note` chỉ trả khi là HR hoặc chính chủ |
| POST | `/employees` | HR | 201 `EmployeeDetail`. `code` trống → tự sinh; mã được chuyển chữ HOA |
| PUT | `/employees/{id}` | HR | 200 `EmployeeDetail` |
| POST | `/employees/{id}/resign` | HR | `{ leftAt }` → 204 |
| POST | `/employees/{id}/reactivate` | HR | 204 |

### Validate khi tạo / sửa (`ValidateAsync`, 400 theo field)

| Field | Lỗi |
|---|---|
| `fullName` | `"Họ tên không được để trống"`, tối đa 200 |
| `code` | `"Mã nhân viên đã tồn tại"`, tối đa 30 |
| `email` | `"Email không hợp lệ"`, `"Email đã được dùng cho nhân viên khác"` (so chữ thường) |
| `joinedAt` | `"Ngày vào làm không được để trống"` |
| `status` | `"Trạng thái không hợp lệ"`; gửi `Resigned` → `"Dùng chức năng 'Nghỉ việc' để chuyển trạng thái nghỉ việc"` |
| `departmentId` / `positionId` | `"Phòng ban không tồn tại"` / `"Chức vụ không tồn tại"` |
| `managerId` | `"Không thể tự quản lý chính mình"`, `"Quản lý không tồn tại hoặc đã nghỉ việc"`, `"Người này đang là cấp dưới, không thể làm quản lý (vòng lặp)"` |

### Nghỉ việc / khôi phục

| Thao tác | Tác động |
|---|---|
| `resign` | `leftAt < joinedAt` → 400 `"Ngày nghỉ việc phải sau ngày vào làm"`. `Status = Resigned`, `LeftAt`; gỡ `ManagerId` của mọi cấp dưới và `HeadEmployeeId` của phòng ban (ExecuteUpdate); `IAccountService.SetActiveAsync(false)` |
| `reactivate` | `Status = Active`, `LeftAt = null`; mở khoá tài khoản. **Không** khôi phục quan hệ quản lý / trưởng phòng đã gỡ |

Không có API xoá nhân viên (giữ dữ liệu chấm công).

## Cấp tài khoản

Mời qua email / mật khẩu tạm, đổi vai trò, bảo vệ vai trò admin → [organization-accounts.md](organization-accounts.md). Nhập hồ sơ hàng loạt từ Excel → [employee-import.md](employee-import.md).

## Phòng ban & chức vụ

| | Phòng ban (`/departments`) | Chức vụ (`/positions`) |
|---|---|---|
| Đọc | `GET` (đăng nhập): kèm `employeeCount` (không tính Resigned), `headName` | `GET`: kèm `employeeCount` |
| Ghi (HR) | `POST` → 201 Guid, `PUT /{id}` → 204, `DELETE /{id}` → 204 (xoá mềm) | tương tự |
| Trùng tên | `"Tên phòng ban đã tồn tại"` | `"Tên chức vụ đã tồn tại"` |
| Ràng buộc khác | cha: `"Phòng ban cha không được là chính nó"`, `"Phòng ban cha không tồn tại"`, `"Không được chọn phòng ban con làm phòng ban cha"`; trưởng phòng: `"Trưởng phòng không tồn tại hoặc đã nghỉ việc"` | — |
| Xoá bị chặn (409) | `"Phòng ban còn phòng ban con, hãy chuyển hoặc xoá phòng ban con trước"`, `"Phòng ban còn nhân viên, hãy chuyển nhân viên sang phòng ban khác trước"` | `"Chức vụ đang có nhân viên, hãy đổi chức vụ cho họ trước"` |

`MapZone` của phòng ban = `areas[].id` hoặc `rooms[].zone` trong `shared/office-map.json` v2 (danh sách: `features/employees/utils/mapZones.ts`; không dùng để xếp chỗ ngồi — chủ dự án bỏ tính năng gán chỗ).

## `IEmployeeDirectory` (Organization.Contracts → `Infrastructure/EmployeeDirectory.cs`)

`GetByUserIdAsync`, `GetAsync`, `ListActiveAsync` (không Resigned, theo `Code`), `GetSubordinateIdsAsync` (cấp dưới trực tiếp + gián tiếp, duyệt cây trong RAM). Trả `EmployeeRef { Id, Code, FullName, UserId, DepartmentId, DepartmentName, ManagerId, IsActive, JoinedAt, LeftAt }`. **Lọc trên `db.Employees` trước khi chiếu sang record** — EF không dịch được `Where` trên record đã chiếu.

## UI (`frontend/src/features/employees/`)

- `EmployeesPage`: 3 tab Nhân viên / Phòng ban / Chức vụ. `canEdit = hasRole(me, 'admin', 'hr')`; người khác chỉ xem danh bạ (ẩn cột Tài khoản và menu thao tác).
- `EmployeeTable`: tìm kiếm (debounce 300ms), lọc phòng ban, "Hiện người đã nghỉ", menu từng dòng: Sửa hồ sơ, Cấp tài khoản, Gửi lại lời mời (khi `invitePending`), Đổi vai trò, Cấp lại mật khẩu tạm, Nghỉ việc / Khôi phục.
- `EmployeeFormDialog` (lỗi field từ server qua `fieldErrors`), `AccountDialogs.tsx` (`CreateAccountDialog`, `RolesDialog`, `TempPasswordDialog`, `ResignDialog`), `DepartmentsPanel`, `PositionsPanel`.
- `CreateAccountDialog` trả mật khẩu tạm lên cha qua `onTempPassword` (dialog đóng ngay khi tạo xong; **đừng** hiển thị mật khẩu bên trong dialog này). Lựa chọn vai trò `admin` chỉ hiện với admin.
