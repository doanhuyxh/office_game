# Dự án: người theo dõi việc (followers)

> TEST-160 (2026-11-18). Code: `backend/src/Modules/Projects/` (`Domain/FollowerRules.cs`, `Features/TaskFollowerEndpoints.cs`), MCP `OfficeHub.Mcp/Tools/ProjectTools.cs`,
> FE `frontend/src/features/projects/components/task-followers`. Test: `FollowerRulesTests`, e2e `scripts/dev/task-followers-e2e.ts`. Về [projects-tasks.md](projects-tasks.md).

## Mục đích

Việc chỉ có một người làm. Người theo dõi = thành viên dự án (người hoặc bot) muốn biết diễn biến của việc không giao cho mình — vd bot DevOps theo dõi việc để biết khi nào việc sang Xong thì deploy.

## Dữ liệu

- Bảng `projects.task_followers (TaskId, EmployeeId, CreatedAt)`, PK (`TaskId`, `EmployeeId`), index `ix_task_followers_employee`, FK cascade → `tasks` (xoá việc → xoá người theo dõi). **Không** FK sang schema `org` — chỉ lưu Id nhân viên (migration `TaskFollowers`).
- Rời dự án không tự xoá dòng theo dõi; chi tiết việc vẫn hiện người đó (bỏ bằng ✕ / MCP).

## API (`/api/projects`)

| Method | Path | |
|---|---|---|
| POST | `/tasks/{tid}/followers/{employeeId}` | Thêm. Người gọi: thành viên có quyền làm (`CanWork`, cả token AI); dự án đóng → 409; người được thêm phải là thành viên dự án → 400 (`FollowerRules.AddError`, tối đa 30 / việc). Đã theo dõi → 204, không ghi gì |
| DELETE | `/tasks/{tid}/followers/{employeeId}` | Bỏ. Cùng quyền; không theo dõi → 204, không ghi gì |

- Không xem được dự án → 404. Token AI: có trong allowlist (`AccessTokenAuth`), áp dụng chặn chuỗi thao tác bot như việc phải chờ.
- Lịch sử việc: `Follow` (to = họ tên người được thêm), `Unfollow` (from = họ tên) — có trong `/activity` (bảng tự cập nhật, toast "X thêm Y theo dõi …").
- `GET /tasks/{tid}` → `followers: [{ employeeId, code, fullName, isBot }]` (sắp theo họ tên). Danh sách việc / việc của tôi: `followerCount`.

## MCP

- `get_task` trả `followers`.
- `create_task` / `update_task`: tham số `followers` — mã nhân viên / họ tên thành viên dự án, cách nhau dấu phẩy; `update_task` **thay toàn bộ** danh sách (thêm người mới, bỏ người không còn), `"none"` = bỏ hết. Người ngoài dự án → lỗi.

## Giao diện

Hộp thoại việc, cột phải dưới "Phải chờ việc": "Người theo dõi (n)" — chip họ tên + nhãn BOT, ✕ bỏ (có vòng xoay); ô chọn tìm được "Thêm người theo dõi" chỉ gợi ý thành viên đang làm chưa theo dõi, chọn là thêm ngay. Không có quyền làm → chỉ xem (ẩn khi trống).

## Chưa làm

Chưa gửi chuông / webhook / Telegram cho người theo dõi (đánh thức `task_done` khi việc xong làm ở việc riêng trên bảng `TEST`).
