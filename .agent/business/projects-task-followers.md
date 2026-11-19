# Dự án: người theo dõi việc + cột "Đánh thức bot theo dõi"

> TEST-160 (người theo dõi, 2026-11-18) · TEST-178 (2026-11-19: bỏ người review TEST-161, thay `review_requested` + `task_done` TEST-166 bằng `column_entered`).
> Code: `backend/src/Modules/Projects/` (`Domain/FollowerRules.cs`, `Domain/FollowerWakeRules.cs`, `Features/TaskFollowerEndpoints.cs`, `Features/TaskEndpoints.cs` → `WakeFollowersAsync`,
> `Features/TaskColumnEndpoints.cs`), Notification `ITelegramWakeup.TaskColumnEnteredAsync`, `TelegramRules.ColumnWakeMessage`, `WebhookEvents.TaskColumnEntered`, MCP `OfficeHub.Mcp/Tools/ProjectTools.cs`,
> FE `frontend/src/features/projects/components/task-followers`. Test: `FollowerRulesTests`, `FollowerWakeRulesTests`, `TelegramRulesTests`, `NotificationCatalogTests`;
> e2e `scripts/dev/task-followers-e2e.ts`, `scripts/dev/task-column-wake-e2e.ts`. Về [projects-tasks.md](projects-tasks.md).

## Mục đích (chủ dự án chốt 2026-11-19)

Có nhiều loại dự án (không chỉ code) → việc chỉ còn **người làm** + **người theo dõi**; không có vai "người review" riêng — người review (người hay bot) là một người theo dõi.
Cột có MỘT ô tick **"Đánh thức bot theo dõi"**: việc vào cột có tick → mọi bot theo dõi được đánh thức; bot tự đọc hướng dẫn chức vụ + workGuide dự án để biết ở cột đó
mình có việc không (vd bot review làm ở "Chờ review", bot DevOps làm ở "Deploy").

## Dữ liệu

- Bảng `projects.task_followers (TaskId, EmployeeId, CreatedAt)`, PK (`TaskId`, `EmployeeId`), index `ix_task_followers_employee`, FK cascade → `tasks` (xoá việc → xoá người theo dõi). **Không** FK sang schema `org` — chỉ lưu Id nhân viên (migration `TaskFollowers`).
- Rời dự án không tự xoá dòng theo dõi; chi tiết việc vẫn hiện người đó (bỏ bằng ✕ / MCP).
- `projects.task_columns.WakeFollowers` (bool). Migration `TaskWakeFollowers` (TEST-178): người review cũ (`tasks.ReviewerEmployeeId`) → thêm vào `task_followers` (đã có thì bỏ qua) rồi xoá cột;
  `task_columns.IsReview` đổi tên → `WakeFollowers` (giữ giá trị) + đặt `true` cho mọi cột `IsDone` (dự án đang chạy giữ hành vi `task_done` cũ). Dự án mới: cột mặc định "Chờ review" có `WakeFollowers` (`TaskColumnRules.Defaults`).
- Lịch sử việc kiểu `Reviewer` (TEST-161, from / to = họ tên) vẫn còn trong DB và vẫn đọc / hiển thị được; không ghi mới.

## API (`/api/projects`)

| Method | Path | |
|---|---|---|
| POST | `/tasks/{tid}/followers/{employeeId}` | Thêm. Người gọi: thành viên có quyền làm (`CanWork`, cả token AI); dự án đóng → 409; người được thêm phải là thành viên dự án → 400 (`FollowerRules.AddError`, tối đa 30 / việc). Đã theo dõi → 204, không ghi gì |
| DELETE | `/tasks/{tid}/followers/{employeeId}` | Bỏ. Cùng quyền; không theo dõi → 204, không ghi gì |

- Không xem được dự án → 404. Token AI: có trong allowlist (`AccessTokenAuth`), áp dụng chặn chuỗi thao tác bot như việc phải chờ.
- Lịch sử việc: `Follow` (to = họ tên người được thêm), `Unfollow` (from = họ tên) — có trong `/activity` (bảng tự cập nhật, toast "X thêm Y theo dõi …").
- `GET /tasks/{tid}` → `followers: [{ employeeId, code, fullName, isBot }]` (sắp theo họ tên) + `columns[].wakeFollowers` (runner kiểm tra lại việc còn ở cột có tick). Danh sách việc / việc của tôi: `followerCount`.
- Không còn `reviewerId` (POST / PUT việc — gửi lên bị bỏ qua), `reviewer` / `reviewerEmployeeId` (DTO).
- Cột: `GET /{id}/columns` → `wakeFollowers`; `POST /{id}/columns`, `PUT /columns/{cid}` nhận `wakeFollowers` (bỏ trống khi sửa = giữ nguyên, khi thêm = false). Quyền như sửa cột (chức vụ "Quản lý trạng thái công việc", không qua token AI).

## Đánh thức `column_entered` (`FollowerWakeRules`)

- `TaskEndpoints.MoveAsync` / `UpdateAsync` (đổi `columnId`) → `WakeFollowersAsync` khi `ShouldWake`: việc chuyển **vào** cột `WakeFollowers` từ **một cột khác** (chuyển giữa hai cột có tick cũng bắn; lùi rồi vào lại → bắn lại).
  **Ai chuyển cũng bắn** (người thật hay token AI). Tạo việc thẳng vào cột / đổi cờ cột / xoá cột chuyển việc hàng loạt → không bắn.
- Người nhận (`BotTargets`): người theo dõi có tài khoản **bot đang hoạt động**, mỗi tài khoản một lần, **bỏ người thao tác**. Người theo dõi là người thật → không có tin riêng (đã có chuông hoạt động chung như mọi thành viên).
- Mỗi bot: Telegram `ITelegramWakeup.TaskColumnEnteredAsync` (hàng đợi `Kind = task_column_entered`):
  `{"employee_code":<mã bot>,"project_id","task_id","task_code","event":"column_entered","column_id","assignee_code"?}` — không có tên / nội dung việc.
- Webhook `task.column_entered` (chỉ các bot trên): `taskId, taskCode, title, projectId, projectCode, projectName, columnId, column, assigneeEmployeeId, assigneeCode, assigneeName, movedBy, movedByBot`.
- Danh mục `NotificationCatalog`: `projects.task_column_entered` (không chuông; Telegram + webhook). Đã bỏ `projects.task_review_requested`, `projects.task_done_followers`, chuông riêng "Cần review".
- Giữ nguyên: chuông hoạt động chung, "Trả lại việc" (`returned`), "Chờ duyệt / Đã duyệt", "Sẵn sàng" (`ready`), rào chắn token AI không duyệt.
- e2e `task-column-wake-e2e.ts` 24/24 trên DB tạm (2026-11-19) + migration xuống / lên trên cùng DB tạm (người review cũ → người theo dõi, cột `IsDone` có tick).

## MCP

- `get_task` trả `followers` (+ `columns`).
- `create_task` / `update_task`: tham số `followers` — mã nhân viên / họ tên thành viên dự án, cách nhau dấu phẩy; `update_task` **thay toàn bộ** danh sách (thêm người mới, bỏ người không còn), `"none"` = bỏ hết. Người ngoài dự án → lỗi.
- TEST-179: bỏ tham số `reviewer` (`create_task` / `update_task`) và trường `reviewer` (`get_task`). `get_project` / `get_task` → `columns[].wakeFollowers` (việc vào cột → bot theo dõi được đánh thức). `update_task_status`: chuyển theo quy trình workGuide, không tự sang trạng thái hoàn thành trừ khi workGuide ghi rõ.

## Giao diện

Hộp thoại việc, cột phải ngay sau "Mốc", trước "Phải chờ việc" (TEST-172): "Người theo dõi (n)" — chip họ tên + nhãn BOT, ✕ bỏ (có vòng xoay); ô chọn tìm được "Thêm người theo dõi" chỉ gợi ý thành viên đang làm chưa theo dõi, chọn là thêm ngay. Không có quyền làm → chỉ xem (ẩn khi trống).
TEST-179: bỏ ô "Người review" ở hộp thoại việc. Hộp thoại cột: checkbox **"Đánh thức bot theo dõi"** (`wakeFollowers`, `data-testid=col-wake`) kèm dòng giải thích. Lịch sử `Reviewer` cũ vẫn hiển thị.
