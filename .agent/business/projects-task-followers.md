# Dự án: người theo dõi việc + cột "Đánh thức bot theo dõi"

> TEST-160 (người theo dõi, 2026-11-18) · TEST-178 (2026-11-19: bỏ người review TEST-161, thay `review_requested` + `task_done` TEST-166 bằng `column_entered`) · TEST-184 (chọn bot được đánh thức ở từng cột).
> Code: `backend/src/Modules/Projects/` (`Domain/FollowerRules.cs`, `Domain/FollowerWakeRules.cs`, `Features/TaskFollowerEndpoints.cs`, `Features/TaskEndpoints.cs` → `WakeFollowersAsync`,
> `Features/TaskColumnEndpoints.cs`), Notification `ITelegramWakeup.TaskColumnEnteredAsync`, `TelegramRules.ColumnWakeMessage`, `WebhookEvents.TaskColumnEntered`, MCP `OfficeHub.Mcp/Tools/ProjectTools.cs`,
> FE `frontend/src/features/projects/components/task-followers`. Test: `FollowerRulesTests`, `FollowerWakeRulesTests`, `TelegramRulesTests`, `NotificationCatalogTests`;
> e2e `scripts/dev/task-followers-e2e.ts`, `scripts/dev/task-column-wake-e2e.ts`. Về [projects-tasks.md](projects-tasks.md).

## Mục đích (chủ dự án chốt 2026-11-19)

Có nhiều loại dự án (không chỉ code) → việc chỉ còn **người làm** + **người theo dõi**; không có vai "người review" riêng — người review (người hay bot) là một người theo dõi.
Cột có ô tick **"Đánh thức bot theo dõi"**: việc vào cột có tick → bot theo dõi được đánh thức; bot tự đọc hướng dẫn chức vụ + workGuide dự án để biết ở cột đó
mình có việc không (vd bot review làm ở "Chờ review", bot DevOps làm ở "Deploy"). TEST-184: cột chọn được bot nào được đánh thức (bớt phiên thừa).

## Dữ liệu

- Bảng `projects.task_followers (TaskId, EmployeeId, CreatedAt)`, PK (`TaskId`, `EmployeeId`), index `ix_task_followers_employee`, FK cascade → `tasks` (xoá việc → xoá người theo dõi). **Không** FK sang schema `org` — chỉ lưu Id nhân viên (migration `TaskFollowers`).
- Rời dự án không tự xoá dòng theo dõi; chi tiết việc vẫn hiện người đó (bỏ bằng ✕ / MCP).
- `projects.task_columns.WakeFollowers` (bool; migration `TaskWakeFollowers` TEST-178 — chi tiết [database.md](../database.md)). Dự án mới: cột mặc định "Chờ review" có `WakeFollowers` (`TaskColumnRules.Defaults`).
- `task_columns.WakeBotIds` (`uuid[]`, mặc định `'{}'`, Id nhân viên, không FK sang `org`; migration `ColumnWakeBotIds`, TEST-184): rỗng = mọi bot theo dõi (cột cũ giữ hành vi).
- Lịch sử việc kiểu `Reviewer` (TEST-161, from / to = họ tên) vẫn còn trong DB và vẫn đọc / hiển thị được; không ghi mới.

## API (`/api/projects`)

| Method | Path | |
|---|---|---|
| POST | `/tasks/{tid}/followers/{employeeId}` | Thêm. Người gọi: thành viên có quyền làm (`CanWork`, cả token AI); dự án đóng → chỉ quản lý dự án / HR trên web, còn lại 409 ([projects-closed.md](projects-closed.md)); người được thêm phải là thành viên dự án → 400 (`FollowerRules.AddError`, tối đa 30 / việc). Đã theo dõi → 204, không ghi gì |
| DELETE | `/tasks/{tid}/followers/{employeeId}` | Bỏ. Cùng quyền; không theo dõi → 204, không ghi gì |

- Không xem được dự án → 404. Token AI: có trong allowlist (`AccessTokenAuth`), áp dụng chặn chuỗi thao tác bot như việc phải chờ.
- Lịch sử việc: `Follow` (to = họ tên người được thêm), `Unfollow` (from = họ tên) — có trong `/activity` (bảng tự cập nhật, toast "X thêm Y theo dõi …").
- `GET /tasks/{tid}` → `followers: [{ employeeId, code, fullName, isBot }]` (sắp theo họ tên) + `columns[].wakeFollowers` / `wakeBotIds` (runner kiểm tra lại việc còn ở cột có tick). Danh sách việc / việc của tôi: `followerCount`.
- Không còn `reviewerId` (POST / PUT việc — gửi lên bị bỏ qua), `reviewer` / `reviewerEmployeeId` (DTO).
- Cột: `GET /{id}/columns` → `wakeFollowers`, `wakeBotIds`; `POST /{id}/columns`, `PUT /columns/{cid}` nhận `wakeFollowers` (bỏ trống khi sửa = giữ nguyên, khi thêm = false) + `wakeBotIds`
  (bỏ trống khi sửa = giữ, `[]` = tất cả; mỗi Id phải là **thành viên dự án là tài khoản bot** → sai 400 `wakeBotIds`; bỏ trùng; tắt `wakeFollowers` → xoá danh sách). Quyền như sửa cột (chức vụ "Quản lý trạng thái công việc", không qua token AI).

Hướng dẫn riêng của cột (`guide`, `hasGuide`, `columnGuide` — TEST-186): [projects-column-guides.md](projects-column-guides.md).

## Đánh thức `column_entered` (`FollowerWakeRules`)

- `TaskEndpoints.MoveAsync` / `UpdateAsync` (đổi `columnId`) → `WakeFollowersAsync` khi `ShouldWake`: việc chuyển **vào** cột `WakeFollowers` từ **một cột khác** (chuyển giữa hai cột có tick cũng bắn; lùi rồi vào lại → bắn lại).
  **Ai chuyển cũng bắn** (người thật hay token AI). Tạo việc thẳng vào cột / đổi cờ cột / xoá cột chuyển việc hàng loạt → không bắn.
- Người nhận (`BotTargets`): người theo dõi có tài khoản **bot đang hoạt động**, mỗi tài khoản một lần, **bỏ người thao tác**; cột có `WakeBotIds` → chỉ bot **vừa theo dõi việc vừa trong danh sách** và còn là thành viên dự án (bot được chọn không theo dõi / rời dự án / khoá → không đánh thức, không quay về "tất cả"). Người theo dõi là người thật → không có tin riêng (đã có chuông hoạt động chung như mọi thành viên).
- Mỗi bot: Telegram `ITelegramWakeup.TaskColumnEnteredAsync` (hàng đợi `Kind = task_column_entered`):
  `{"employee_code":<mã bot>,"project_id","task_id","task_code","event":"column_entered","column_id","assignee_code"?}` — không có tên / nội dung việc.
- Runner (`agent-runner/`): job `follow` — bot tự đọc hướng dẫn để biết ở cột đó có bước không, chỉ bình luận khi có làm ([agent-runner-follow.md](agent-runner-follow.md), TEST-180).
- Webhook `task.column_entered` (chỉ các bot trên): `taskId, taskCode, title, projectId, projectCode, projectName, columnId, column, assigneeEmployeeId, assigneeCode, assigneeName, movedBy, movedByBot`.
- Danh mục `NotificationCatalog`: `projects.task_column_entered` (không chuông; Telegram + webhook). Đã bỏ `projects.task_review_requested`, `projects.task_done_followers`, chuông riêng "Cần review".
- Giữ nguyên: chuông hoạt động chung, "Trả lại việc" (`returned`), "Chờ duyệt / Đã duyệt", "Sẵn sàng" (`ready`), rào chắn token AI không duyệt.
- e2e `task-column-wake-e2e.ts` trên DB tạm ([e2e.md](../e2e.md)).

## MCP

- `get_task` trả `followers` (+ `columns`).
- `create_task` / `update_task`: tham số `followers` — mã nhân viên / họ tên thành viên dự án, cách nhau dấu phẩy; `update_task` **thay toàn bộ** danh sách (thêm người mới, bỏ người không còn), `"none"` = bỏ hết. Người ngoài dự án → lỗi.
- TEST-179: bỏ tham số `reviewer` (`create_task` / `update_task`) và trường `reviewer` (`get_task`). `get_project` / `get_task` → `columns[].wakeFollowers` (việc vào cột → bot theo dõi được đánh thức) + `wakeBotIds` (TEST-184: rỗng = mọi bot theo dõi; có giá trị = chỉ các bot này, phải đang theo dõi việc). `update_task_status`: chuyển theo quy trình workGuide, không tự sang trạng thái hoàn thành trừ khi workGuide ghi rõ.

## Giao diện

Hộp thoại việc, cột phải ngay sau "Mốc", trước "Phải chờ việc" (TEST-172): "Người theo dõi (n)" — chip họ tên + nhãn BOT, ✕ bỏ (có vòng xoay); ô chọn tìm được "Thêm người theo dõi" chỉ gợi ý thành viên đang làm chưa theo dõi, chọn là thêm ngay. Không có quyền làm → chỉ xem (ẩn khi trống).
TEST-179: bỏ ô "Người review" ở hộp thoại việc. Hộp thoại cột: công tắc **"Đánh thức bot theo dõi"** (`wakeFollowers`, `data-testid=col-wake`, `Switch` từ TEST-189). Lịch sử `Reviewer` cũ vẫn hiển thị.
TEST-184 / TEST-189: bật → mục "Bot được gọi" (`col-wake-bots`): thẻ tên bot đã chọn (tên + mã + BOT, ✕ bỏ — `col-wake-chip-<mã>` / `col-wake-bot-remove-<mã>`), nút "+ Thêm bot" (`col-wake-add`)
mở danh sách bot thành viên chưa chọn (`col-wake-bot-<mã>`); chưa chọn ai → "Mọi bot theo dõi việc sẽ được gọi" (`col-wake-all`); ghi chú dài trong (i); không có bot → "Dự án chưa có thành viên là bot"; tắt → ẩn + gửi `[]`.
Bố cục hộp thoại cột + biểu tượng bot trên tiêu đề cột: [projects-column-guides.md](projects-column-guides.md#giao-diện).
