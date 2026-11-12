# Dự án: phòng ban tham gia, quyền xem theo phòng ban, tab Phụ lục (TEST-40)

> Chủ dự án chốt 2026-11-12. Code: `backend/src/Modules/Projects/` (`Domain/ProjectDepartmentRules.cs`, `Infrastructure/ProjectServices.cs` — `ProjectViewer`, `ProjectPermissions`; `Features/ProjectAppendixEndpoints.cs`), FE `frontend/src/features/projects/components/{department-picker,project-appendix,appendix-departments,appendix-members,appendix-other-access}`. Test: `ProjectDepartmentAccessTests`, e2e `scripts/dev/project-departments-e2e.ts`. Về [projects.md](projects.md).

## Dữ liệu

- Bảng `projects.project_departments` (`ProjectId`, `DepartmentId`, `IsLead`, `CreatedAt`; PK dự án + phòng; index `DepartmentId`; FK cascade về `projects`, **không** FK sang `org` — tên phòng tra qua `IEmployeeDirectory.ListDepartmentsAsync`). `[Audited]`.
- Tối đa **20** phòng / dự án; tối đa **một** phòng chủ trì, phải nằm trong danh sách. Phòng không tồn tại → 400 `departmentIds`; chủ trì ngoài danh sách → 400 `leadDepartmentId`.
- Migration `ProjectDepartments`: `projects.DepartmentId` cũ → 1 dòng `IsLead = true`, rồi bỏ cột (Down làm ngược lại từ phòng chủ trì). Chép dự án cũ từ Documents (`ProjectsMigrator`) cũng tạo phòng chủ trì.
- API: `UpsertProject.departmentIds[]` + `leadDepartmentId` (sửa: `departmentIds` null = giữ nguyên); `ProjectDto.departments[{ id, name, isLead }]` (chủ trì đứng đầu) + `viaDepartment`. `GET /api/projects?departmentId=` lọc theo bất kỳ phòng tham gia. Contracts: `ProjectRef(DepartmentIds, LeadDepartmentId)`.
- Đổi danh sách phòng = sửa thông tin dự án → chuông "Phòng ban tham gia: … → …" cho thành viên (TEST-38). Chuông dự án vẫn **chỉ** gửi thành viên, không gửi cả phòng ban.

## Quyền (`ProjectViewer`)

- `DeptProjects` = dự án có phòng của người xem (`Employee.DepartmentId`, đúng phòng, **không tính phòng con**) tham gia. `CanSee` = HR / admin, quyền Xem tài chính, thành viên **hoặc** `DeptProjects`. `ViaDepartment` = thấy chỉ nhờ phòng ban.
- Người xem nhờ phòng ban **chỉ đọc**: xem dự án, việc, hướng dẫn, mốc, yêu cầu thay đổi, thành viên, phụ lục. Không tạo / sửa / chuyển việc, không bình luận (`CanWork` theo thành viên), không sửa cột kể cả chức vụ có cờ "Quản lý trạng thái công việc" (`CanManageColumns` chỉ ở dự án thấy đầy đủ), không xem Ngày công / Tài chính, không vào kho tài liệu dự án (Documents vẫn dùng `RolesOfAsync` = thành viên). Token AI của họ cũng vậy (MCP `create_task` bị chặn).
- Danh sách dự án: tab "Tất cả tôi xem được" gồm dự án của phòng mình (thẻ ghi "Xem nhờ phòng ban — chỉ đọc"); "Của tôi" (`mine=true`) chỉ dự án là thành viên. Luồng `/activity` (tự cập nhật + toast) vẫn chỉ cho thành viên / HR / Xem tài chính.

## Bảng quyền + tab Phụ lục

- `ProjectPermissions.All` — 7 quyền, mỗi quyền gọi đúng một hàm của `ProjectViewer`: `view`, `work`, `manage`, `columns`, `effort`, `finance`, `documents` (`CanSeeDocuments` khớp `DocumentAccess.CanRead` của Documents: HR / thành viên).
- `GET /api/projects/{id}/appendix` (ai xem được dự án; token AI không có trong allowlist): `capabilities`, `personas` (Quản lý dự án, Thành viên, Nhân viên phòng ban tham gia, HR / quản trị, Quyền Xem tài chính, Thành viên có chức vụ "Quản lý trạng thái công việc" — quyền tính bằng `ProjectViewer` giả lập), `departments` (chủ trì trước, số nhân viên đang làm), `members` (mã, phòng ban, vai trò, `isBot` từ `IAccountService`, đã nghỉ). FE chỉ hiển thị, không viết cứng quyền. Test `ProjectDepartmentAccessTests` khoá kỳ vọng từng vai trò — đổi quy tắc mà quên cập nhật thì test fail.
- `GET /api/projects/{id}` trả thêm `myAccess` (khoá quyền của người xem) → FE ẩn / hiện tab Ngày công, Tài chính, nút "Tài liệu dự án"; MCP `get_project` trả kèm để bot biết mình được làm gì.

## UI

Form dự án: ô "Phòng ban tham gia" (tìm + thêm, nút "Đặt chủ trì" / "Chủ trì", ✕ bỏ; phòng đầu tiên tự là chủ trì). Chi tiết dự án: dòng phòng ban dưới tên ("B (chủ trì), A"), ghi chú chỉ đọc khi `viaDepartment`, tab **Phụ lục** (3 khối: phòng ban, thành viên, quyền khác). Danh sách: dòng phòng ban trên thẻ, bộ lọc "Phòng ban tham gia".
