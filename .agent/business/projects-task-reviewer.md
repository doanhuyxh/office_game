# Dự án: người review việc + cột review (đánh thức `review_requested`)

> TEST-161 (2026-11-18). Code: `backend/src/Modules/Projects/` (`Domain/ReviewerRules.cs`, `Features/TaskEndpoints.cs` → `NotifyReviewRequestedAsync`, `Features/TaskColumnEndpoints.cs`),
> Notification `ITelegramWakeup.TaskReviewRequestedAsync`, `TelegramRules.ReviewWakeMessage`, `WebhookEvents.TaskReviewRequested`, MCP `OfficeHub.Mcp/Tools/ProjectTools.cs`,
> FE `features/projects/components/{task-dialog,column-dialog}`. Test: `ReviewerRulesTests`, `TelegramRulesTests`, `NotificationCatalogTests`. Về [projects-tasks.md](projects-tasks.md).

## Mục đích

Nhiều agent cùng làm một tính năng: agent C code, agent D review **ngay trên việc của C**. Tách review thành việc riêng phụ thuộc việc code thì sai thứ tự (việc code phải Xong mới review được) → có vai "người review" trên việc.

## Dữ liệu (migration `TaskReviewer`)

- `projects.tasks.ReviewerEmployeeId` (uuid, null) — chỉ lưu Id nhân viên, **không** FK sang schema `org`.
- `projects.task_columns.IsReview` (bool, mặc định false). Migration đặt `IsReview = true` cho mọi cột tên **"Chờ review"** có sẵn; dự án mới: cột mặc định "Chờ review" có `IsReview` (`TaskColumnRules.Defaults`).
- Lịch sử việc `Reviewer` (from / to = họ tên người review cũ / mới).

## Luật (`ReviewerRules`)

- Người review phải là **thành viên dự án** và **khác người làm** → 400 `reviewerId` (kiểm trên giá trị cuối cùng của PUT / POST — đổi người làm thành người review cũng 400).
- Báo "Cần review" khi việc chuyển **vào** cột `IsReview` từ một cột **không** phải cột review (`POST /tasks/{id}/move` hoặc `PUT /tasks/{id}` đổi `columnId`), việc có người review và người review không phải người thao tác. Lùi rồi chuyển vào lại → báo lại. Chuyển giữa hai cột review / tạo việc thẳng vào cột review → không báo.
- Cột review **không** đổi quyền chuyển việc (khác `ApproverOnly`). Rào chắn giữ nguyên: bot review chỉ bình luận, không duyệt / không chuyển vào cột cần người duyệt.

## Thông báo

- Chuông **"Cần review: CODE tên"** cho người review (category `ProjectTask`, có webhook `notification` như mọi chuông); người review không nhận thêm chuông "hoạt động việc" cho lần chuyển đó.
- Người review là **tài khoản bot** → thêm:
  - Telegram `event: review_requested` (hàng đợi `Kind = task_review_requested`): `employee_code` (mã người review), `project_id`, `task_id`, `task_code`, `assignee_code` (khi việc có người làm). Không có tên / nội dung việc.
  - Webhook `task.review_requested` chỉ cho người review: `taskId, taskCode, title, projectId, projectName, column, assigneeEmployeeId, assigneeCode, assigneeName, movedBy`.
- Danh mục `NotificationCatalog`: `projects.task_review_requested`.
- Runner (`agent-runner/`) chưa xử lý `review_requested` — phiên review chỉ đọc nhánh việc làm ở TEST-167.

## API

- `PUT /api/projects/tasks/{id}` / `POST /api/projects/{id}/tasks`: `reviewerId` (Guid?). **Như người làm**: sửa phải gửi giá trị hiện tại, `null` = bỏ người review.
- `GET /tasks/{id}` → `reviewer: { employeeId, code, fullName, isBot } | null`; danh sách việc → `reviewerEmployeeId`.
- Cột: `GET /{id}/columns` → `isReview`; `POST /{id}/columns`, `PUT /columns/{cid}` nhận `isReview` (bỏ trống khi sửa = giữ nguyên). Quyền như sửa cột hiện tại (chức vụ "Quản lý trạng thái công việc", không qua token AI).

## MCP

- `get_task` trả `reviewer`.
- `create_task` / `update_task`: tham số `reviewer` (mã nhân viên / họ tên thành viên dự án; `update_task`: `"none"` = bỏ; bỏ trống = giữ nguyên).

## Giao diện

- Hộp thoại việc, cột phải: ô chọn **"Người review"** dưới "Người làm" (thành viên đang làm trừ người làm, bot có hậu tố "(BOT)"); đổi người làm thành người review → ô người review tự xoá.
- Hộp thoại trạng thái (cột): checkbox **"Cột review"**.
