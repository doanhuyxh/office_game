# Nhân sự: nhân viên, phòng ban, chức vụ, cấp tài khoản (module Organization)

> Nguồn sự thật là code (`backend/src/Modules/Organization/`, `frontend/src/features/employees/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Mọi route dưới `/api/org` yêu cầu đăng nhập. Ghi = policy `AuthPolicies.Hr` (admin | hr). Schema: [database.md](../database.md#schema-org--orgdbcontext-migration-initialorganization).

## Nhân viên (`Features/Employees/EmployeeEndpoints.cs`)

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/employees?search=&departmentId=&status=&includeResigned=&page=&pageSize=` | đăng nhập | Danh bạ liên lạc cho mọi người (có `page` → trang, theo mã NV; không → cả danh sách cho MCP / form). `search` ILIKE `FullName`/`Code`/`Email`. **Chỉ HR**: `includeResigned`, lọc `status`, `account`. `status` / `joinedAt` / `leftAt` = null trừ khi người xem là HR, chính chủ hoặc quản lý (trực tiếp / gián tiếp) — `HrFieldsVisibilityAsync` (chủ dự án chốt 2026-11-06) |
| GET | `/employees/me` | đăng nhập | 404 nếu tài khoản chưa gắn hồ sơ |
| GET | `/employees/next-code` | HR | `NV` + số lớn nhất + 1, 3 chữ số (`NV001`) |
| GET | `/employees/{id}` | đăng nhập | `account`, `dateOfBirth`, `note` chỉ HR / chính chủ; `status` / `joinedAt` như danh sách; người đã nghỉ → 404 với người không phải HR |
| GET | `/employees/{id}/summary` | HR / quản lý | Hồ sơ cơ bản cho trợ lý AI (TEST-79, `get_employee`): DTO riêng `EmployeeSummary` (mã, họ tên, phòng ban, chức vụ + cấp, chức danh, quản lý, `joinedAt` / `leftAt`, `status`) — **không** CCCD / ngân hàng / địa chỉ / ngày sinh / ghi chú / tài khoản. HR mọi người; khác: chính mình + cấp dưới (`HrFieldsVisibilityAsync`), còn lại 403; người đã nghỉ → 404 với người không phải HR |
| POST | `/employees` | HR | 201 `EmployeeDetail`. `code` trống → tự sinh; mã được chuyển chữ HOA |
| PUT | `/employees/{id}` | HR | 200 `EmployeeDetail` |
| POST | `/employees/{id}/resign` | HR | `{ leftAt }` → 204 |
| POST | `/employees/{id}/reactivate` | HR | 204 |

UI `/employees`: tab **Nhân viên** chỉ người đang làm; tab **Đã nghỉ việc** (chỉ HR, `?tab=resigned`, gọi `status=Resigned`) liệt kê người đã nghỉ — khôi phục, sửa, xuất Excel; không có "Thêm nhân viên" / nghỉ việc hàng loạt.

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

Mời qua email / mật khẩu tạm, đổi vai trò, bảo vệ vai trò admin → [organization-accounts.md](organization-accounts.md). Nhập hồ sơ hàng loạt từ Excel → [employee-import.md](employee-import.md). Tích chọn + thao tác hàng loạt (đổi phòng ban / quản lý / chức vụ, nghỉ việc, xuất Excel) → [employee-bulk.md](employee-bulk.md).

## Phòng ban & chức vụ

Chủ dự án chốt 2026-11-06: **phòng ban mở rộng tự do** (cây nhiều cấp), **chức vụ = cấp bậc** (`Level`, 1 = cao nhất, bắt buộc, nhiều chức vụ được cùng cấp; HR vẫn thêm / sửa / xoá), **chức danh** = công việc cụ thể, chữ tự do trên hồ sơ (`Employee.JobTitle`: Lễ tân, Lập trình viên…).

- Thang mặc định (`Domain/PositionLadder.cs`): 1 Giám đốc · 2 Phó giám đốc · 3 Trưởng phòng · 4 Phó phòng · 5 Trưởng nhóm · 6 Chuyên viên · 7 Nhân viên · 8 Thực tập sinh.
- Chức vụ có cờ **`SelfPublishDocuments`** ("Tự ban hành tài liệu", HR bật trong hộp sửa chức vụ): chỉ cấp 1–`SpecialistLevel` (6, Chuyên viên) — cấp thấp hơn → 400 `selfPublishDocuments`; `IEmployeeDirectory.GetPositionAsync` trả cờ đã xét cấp. Dùng ở kho tài liệu ([documents.md](documents.md)).
- Chức vụ có cờ **`ManageTaskColumns`** ("Quản lý trạng thái công việc", 2026-11-11): HR bật / tắt; `UpsertPositionRequest.manageTaskColumns` null = giữ; `PositionRef.ManageTaskColumns`. Dùng ở module Projects ([projects-tasks.md](projects-tasks.md)); vai trò admin / hr không thay thế.
- Chức vụ có **quyền tài chính** (`FinancePermissions`, bit: 1 Xem · 2 Ghi sổ · 4 Duyệt chi · 8 Quản trị; Ghi / Duyệt / Quản trị bao hàm Xem — `FinancePermissions.Normalize`). Chủ dự án chốt 2026-11-08: chỉ giám đốc + kế toán xem tiền, cấu hình theo chức vụ ([docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md)). **Chỉ admin hoặc người có quyền Quản trị tài chính được đổi** — HR sửa tên / cấp chức vụ bình thường nhưng đổi quyền tài chính → 403; trường `financePermissions` bỏ trống = giữ nguyên. Vai trò `admin` **không** tự có quyền xem tiền. Quyền của một tài khoản = quyền chức vụ của hồ sơ gắn với nó (`IFinanceAccess` ở Organization.Contracts; nhân viên đã nghỉ / không có hồ sơ → không có quyền). `GET /api/org/positions/my-finance` → `{ permissions, canManage }`. `PositionDto.departmentCount` để FE cảnh báo khi bật quyền tiền cho chức vụ dùng chung nhiều phòng (vd "Trưởng phòng") — nên tạo chức vụ riêng như "Kế toán trưởng". **Chưa làm**: bắt buộc 2FA cho người có quyền tài chính (Identity không biết chức vụ — làm ở module Finance), thông báo chuông khi đổi quyền (hiện chỉ có lịch sử `[Audited]`).
- `OrgMigrator.EnsurePositionLadderAsync` chạy **một lần** khi khởi động (DB chưa có chức vụ, hoặc còn chức vụ `Level = 0`): thêm bậc mặc định còn thiếu; chức vụ cũ khớp tên → gán cấp; tên nằm trong `JobFunctionNames` ("Lễ tân") → chuyển thành chức danh của nhân viên + cấp Nhân viên, xoá mềm chức vụ đó (chủ dự án cho phép áp dụng cả với NV001); còn lại → cấp 7, HR chỉnh. Ghi qua EF → có trong lịch sử sửa (nguồn `system`). Sau đó không seed lại.
- FE: danh sách phòng ban hiển thị dạng cây (`utils/orgTree.ts`), Select phòng ban thụt lề, không chọn được phòng con làm cha. Form nhân viên: đổi phòng ban → tự điền **quản lý trực tiếp = trưởng phòng** (chính họ là trưởng / phòng chưa có trưởng → trưởng phòng cấp cha gần nhất), chỉ khi ô quản lý đang trống hoặc đang là gợi ý cũ; HR sửa tay được.

| | Phòng ban (`/departments`) | Chức vụ (`/positions`) |
|---|---|---|
| Đọc | `GET` (đăng nhập): kèm `employeeCount` (không tính Resigned), `headName` | `GET`: kèm `employeeCount` |
| Ghi (HR) | `POST` → 201 Guid, `PUT /{id}` → 204, `DELETE /{id}` → 204 (xoá mềm) | tương tự, body `{ name, level, sortOrder? }`; `level` 1–99 bắt buộc; `GET` sắp theo `level` rồi tên |
| Trùng tên | `"Tên phòng ban đã tồn tại"` | `"Tên chức vụ đã tồn tại"` |
| Ràng buộc khác | cha: `"Phòng ban cha không được là chính nó"`, `"Phòng ban cha không tồn tại"`, `"Không được chọn phòng ban con làm phòng ban cha"`; trưởng phòng: `"Trưởng phòng không tồn tại hoặc đã nghỉ việc"` | — |
| Xoá bị chặn (409) | `"Phòng ban còn phòng ban con, hãy chuyển hoặc xoá phòng ban con trước"`, `"Phòng ban còn nhân viên, hãy chuyển nhân viên sang phòng ban khác trước"` | `"Chức vụ đang có nhân viên, hãy đổi chức vụ cho họ trước"` |

`MapZone` của phòng ban = `areas[].id` hoặc `rooms[].zone` trong `shared/office-map.json` v2 (danh sách: `features/employees/utils/mapZones.ts`; không dùng để xếp chỗ ngồi — chủ dự án bỏ tính năng gán chỗ).

**Hồ sơ cá nhân** (liên hệ, ảnh, CCCD, ngân hàng, yêu cầu HR duyệt): [profile.md](profile.md). **Mô tả + hướng dẫn** phòng ban / chức vụ (cho nhân viên + trợ lý AI, trưởng phòng sửa được phòng mình): [org-guides.md](org-guides.md).

## `IEmployeeDirectory` (Organization.Contracts → `Infrastructure/EmployeeDirectory.cs`)

`GetByUserIdAsync`, `GetAsync`, `ListActiveAsync` (không Resigned, theo `Code`), `GetSubordinateIdsAsync` (cấp dưới trực tiếp + gián tiếp, duyệt cây trong RAM). Trả `EmployeeRef { Id, Code, FullName, UserId, DepartmentId, DepartmentName, ManagerId, IsActive, JoinedAt, LeftAt }`. **Lọc trên `db.Employees` trước khi chiếu sang record** — EF không dịch được `Where` trên record đã chiếu.

## UI (`frontend/src/features/employees/`)

- `EmployeesPage`: tab Nhân viên / Phòng ban / Chức vụ + **Sơ đồ tổ chức** (chỉ admin/HR, `org-chart/`: cây CSS thuần `org-chart/org-chart.css`, không thư viện). 2 chế độ: *theo phòng ban* (thẻ phòng: trưởng phòng, số người, nhân viên sắp theo cấp bậc, thu gọn phòng con) và *theo quản lý trực tiếp* (= người duyệt đơn; cấp dưới không quản lý ai xếp thành cột dọc dưới quản lý, > 8 người thì 2 cột, để sơ đồ không trải ngang). Cảnh báo phòng chưa có trưởng / người cấp dưới chưa có quản lý (nhóm riêng). Phóng to / thu nhỏ bằng CSS `zoom`, tự "Vừa khung"; kéo nền để di chuyển (chuột, bỏ qua nút); nút **"Toàn màn hình"** phủ cả cửa sổ + Fullscreen API (Esc thoát), khi đó thẻ phòng hiện đủ nhân viên (không cuộn trong thẻ) và "Vừa khung" tính cả chiều cao (≤ 150%; sơ đồ quá cao thì không thu dưới 60%, cuộn / kéo phần còn lại). Chỉ hiển thị, dữ liệu từ `GET /departments` + `/employees` (không tính người đã nghỉ). `canEdit = hasRole(me, 'admin', 'hr')`; người khác chỉ xem danh bạ (ẩn cột Tài khoản và menu thao tác).
- `EmployeeTable`: tìm kiếm (debounce 300ms), lọc phòng ban, "Hiện người đã nghỉ", menu từng dòng: Sửa hồ sơ, Cấp tài khoản, Gửi lại lời mời (khi `invitePending`), Đổi vai trò, Cấp lại mật khẩu tạm, Nghỉ việc / Khôi phục.
- `EmployeeFormDialog` (lỗi field từ server qua `fieldErrors`), `account-dialogs/` (`CreateAccountDialog`, `RolesDialog`, `TempPasswordDialog`, `ResignDialog`), `DepartmentsPanel`, `PositionsPanel`.
- `CreateAccountDialog` trả mật khẩu tạm lên cha qua `onTempPassword` (dialog đóng ngay khi tạo xong; **đừng** hiển thị mật khẩu bên trong dialog này). Lựa chọn vai trò `admin` chỉ hiện với admin.

Trợ lý AI (MCP, chỉ HR): `create_department` / `update_department` / `delete_department` gọi đúng các endpoint HR ở trên — [mcp.md](mcp.md).
