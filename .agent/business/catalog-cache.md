# Cache danh mục trong RAM (TEST-245, bước B2b)

Danh mục ít đổi nhưng đọc ở gần như mọi request (nhân viên, cây quản lý, phòng ban, chức vụ, quyền tài chính, ca / lịch / ngày lễ) được đọc từ **ảnh chụp trong RAM** thay vì DB. Không đổi business rule, không đổi SRS: quyền vẫn kiểm ở back-end như cũ (luật 1). Chỉ nguồn dữ liệu đổi.

## Cơ chế chung (`BuildingBlocks/Caching`)

- `CatalogCache` (singleton, `CatalogCache.cs`): `GetAsync(key, tag, load)` → `HybridCache` L1 (chỉ RAM, `DisableDistributedCache`), **TTL 5 phút** (`CatalogCache.Ttl`) chỉ là lưới an toàn. Nhiều request cùng lúc chỉ đọc DB một lần. Ảnh chụp là `CatalogSnapshot<T>` sealed + `[ImmutableObject(true)]` nên HybridCache giữ nguyên đối tượng, không serialize.
- Chống đọc cũ: `InvalidateAsync(tags)` ghi mốc xoá theo tag (`Stopwatch`, đơn điệu). Ảnh chụp đọc DB không muộn hơn mốc đó (loader chạy song song với lệnh ghi) bị bỏ và đọc lại, giống [auth-cache.md](auth-cache.md).
- Xoá tự động: `services.AddCatalogCache<TContext>(r => r.On<Entity>(tag…))` (`CatalogCacheInvalidation.cs`), gọi trong `Register` của module. Interceptor bắt **mọi đường ghi** của DbContext module, không cần nhớ gọi tay:
  - SaveChanges: entity khai báo thêm / sửa / xoá (cả xoá mềm) → xoá tag SAU khi ghi, kể cả khi ghi lỗi / bị huỷ.
  - `ExecuteUpdate` / `ExecuteDelete` / SQL thô: câu `INSERT INTO / UPDATE / DELETE FROM / MERGE INTO / TRUNCATE` vào bảng của entity đó (tên bảng + schema lấy từ model EF) → xoá tag sau khi chạy.
  - Đang trong transaction: xoá ngay, rồi **xoá lần nữa khi commit / rollback**. Request đọc lúc transaction chưa commit (thấy dữ liệu cũ) không giữ ảnh chụp cũ.
- Dữ liệu trả ra bất biến: record (`EmployeeRef`, `DepartmentRef`, `PositionRef`), `ImmutableArray` / `FrozenDictionary` trong ảnh chụp; danh sách / dictionary trả cho nơi gọi là bản mới; entity EF (Attendance `Shift`, `ScheduleEntry`) trả **bản sao** (`Copy()`).
- Mỗi module chỉ cache dữ liệu của **chính nó**, sau interface `*.Contracts` / service của module. Module khác không biết có cache (luật 2). Khoá / tag có tiền tố tên module.

## Danh mục đang cache

| Module | Tag (= khoá) | Nội dung | Xoá khi ghi bảng | Dùng ở |
|---|---|---|---|---|
| Organization | `org:employees` | Mọi nhân viên chưa xoá mềm (cả người đã nghỉ): `EmployeeRef` theo id / userId / thứ tự mã, chức vụ của từng người, cây quản lý (quản lý → cấp dưới trực tiếp) | `org.employees`, `org.departments` (EmployeeRef có tên phòng) | `IEmployeeDirectory`: `GetAsync`, `GetByUserIdAsync`, `GetManyAsync`, `ListActiveAsync`, `ListEmployedAsync`, `GetSubordinateIdsAsync`, `GetPositionAsync`; `IFinanceAccess` |
| Organization | `org:departments` | Phòng ban chưa xoá (`DepartmentRef`, theo `SortOrder`, tên) | `org.departments` | `ListDepartmentsAsync` |
| Organization | `org:positions` | Chức vụ chưa xoá (`PositionRef`) + bit quyền tài chính | `org.positions` | `GetPositionAsync`, `IFinanceAccess.GetAsync / ListUserIdsAsync` |
| Attendance | `attendance:calendar` | Mọi ca (cả ca đã xoá mềm, lịch cũ còn trỏ tới), mọi dòng lịch làm việc, mọi ngày lễ | `attendance.shifts`, `attendance.schedules`, `attendance.holidays` | `AttendanceCalendar` → `AttendanceService.ComputeAsync` / `ShiftForAsync`, `IWorkCalendar`, tăng ca (`OvertimeEndpoints`, `AttendanceReports.ApprovedOvertimeAsync`) |

Không cache: tìm người (`SearchActiveAsync`), hồ sơ chi tiết (`GetProfileAsync`, phần ngoài `EmployeeRef`), tài khoản ngân hàng, trang danh sách nhân viên / phòng ban / ca của chính module (đọc DB), bảng công / sự kiện chấm công / đơn / việc / số liệu tài chính (luật 4: bảng công luôn tính từ sự kiện). Thêm danh mục mới: thêm `On<Entity>(tag)` + loader qua `CatalogCache`, kèm unit test "ghi → đọc lại thấy ngay".

## Số câu truy vấn trước / sau (e2e, ~96 nhân viên, 240 việc, lần ít nhất / 5 lần)

Trước = HEAD sau B2a (TEST-244), sau = B2b. `scripts/dev/db-query-count-e2e.ts` (2026-11-26):

| Request | Trước | Sau |
|---|--:|--:|
| `GET /api/attendance/today` (cookie / token) | 8 | 4 |
| `GET /api/attendance/board` (giám đốc) | 9 | 3 |
| `GET /api/leave/requests` (giám đốc / trưởng nhóm) | 5 | 2 |
| `GET /api/approval/inbox/count` (trưởng nhóm) | 4 | 2 |
| `GET /api/projects/{id}` | 20 | 15 |
| `GET /api/projects/{id}/tasks?summary=true` | 8 | 4 |
| `GET /api/projects/tasks/{id}` | 18 | 14 |
| MCP `get_task` (3 request) | 37 | 25 |

## Giới hạn

- ⚠ **Chỉ đúng với MỘT bản Api**: lệnh xoá không tới tiến trình khác. Chạy ≥ 2 bản Api → làm B3 (Redis + phát lệnh xoá, TEST-246) trước.
- Ghi thẳng DB ngoài EF của module (psql, script tay) không xoá cache → thấy sau tối đa 5 phút (hoặc khởi động lại Api).
- `Realtime` / `Mcp` không nạp module Organization / Attendance → không có cache này.

## Kiểm tra

- Unit test: `tests/OfficeHub.Modules.Organization.Tests/OrgCatalogCacheTests.cs` (đổi quản lý → cấp dưới của quản lý cũ / mới đúng ngay, nghỉ việc / xoá mềm, đổi phòng ban, chức vụ, quyền tài chính, nhận diện câu SQL ghi), `tests/OfficeHub.Modules.Attendance.Tests/AttendanceCalendarCacheTests.cs` (ngày lễ, lịch riêng, sửa ca, bản sao).
- e2e (DB tạm): `scripts/dev/catalog-cache-e2e.ts` (HR đổi quản lý → quản lý mới thấy bảng công / đơn nghỉ cấp dưới ngay, quản lý cũ 403; nghỉ việc gỡ quản lý bằng ExecuteUpdate; đổi tên phòng; thêm / xoá ngày lễ bằng ExecuteDelete) + `db-query-count-e2e.ts measure` (kiểm tra 0 câu `org.*` / danh mục chấm công ở request nóng).
