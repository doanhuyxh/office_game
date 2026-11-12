# Dự án: công việc kanban, trạng thái tự do, quy trình duyệt, BOT

> Code: `backend/src/Modules/Projects/` (`Domain/TaskColumnRules.cs`, `Domain/TaskWorkflow.cs`, `Features/TaskColumnEndpoints.cs`, `Features/TaskEndpoints.cs`), FE `frontend/src/features/projects/components/{task-board,column-dialog,task-dialog}`. Test: `TaskColumnRulesTests`, `TaskWorkflowTests`. Về [projects.md](projects.md).

## Trạng thái (cột) tự do — chủ dự án chốt 2026-11-11

- Mỗi dự án có danh sách cột riêng `projects.task_columns` (`Name` ≤ 50, không trùng không phân biệt hoa thường; `Position` 0..n-1 liên tục; `Color` `#rrggbb`; tối đa 15 cột).
- Hai cờ: **`IsDone`** (hoàn thành: việc ở đây có `CompletedAt` → không quá hạn, không nhắc, tính vào % tiến độ; luôn còn ≥ 1 cột hoàn thành) và **`ApproverOnly`** (cần người duyệt: chỉ quản lý dự án / HR chuyển việc vào hoặc kéo lùi ra).
- Dự án mới: 4 cột **Cần làm · Đang làm · Chờ review · Xong** (Xong = hoàn thành + cần người duyệt). Dự án cũ (migration `TaskColumns`): cũng 4 cột, việc gán theo `State` cũ, Xong cần người duyệt nếu dự án từng bật "Xong cần duyệt"; cột `tasks.State` đã xoá. `ProjectsMigrator` thêm 4 cột cho dự án chưa có cột (vd vừa chép từ Documents).
- **Quyền sửa cột theo chức vụ**: cờ `org.positions.ManageTaskColumns` ("Quản lý trạng thái công việc", HR bật trong hộp sửa chức vụ). Người giữ chức vụ đó sửa cột ở **mọi dự án họ xem được**; vai trò admin / hr **không** thay thế. Dự án đóng → 409. Token AI chỉ đọc (`GET /{id}/columns`).
- Bật / tắt `IsDone` → đặt / xoá `CompletedAt` của việc trong cột. Xoá cột còn việc → bắt buộc `moveTo` (ghi lịch sử Moved, note "Xoá trạng thái …"); không xoá cột hoàn thành cuối cùng.

| Method | Path | |
|---|---|---|
| GET | `/{id}/columns` | `[{ id, name, position, color, isDone, approverOnly, taskCount }]` (cũng có trong `GET /{id}` → `columns`, `project.canManageColumns`) |
| POST | `/{id}/columns` | `{ name, color?, isDone, approverOnly }` — thêm cuối bảng; thiếu màu → màu bảng gợi ý |
| PUT | `/columns/{cid}` | như POST; `color` null = giữ |
| PUT | `/{id}/columns/order` | `{ ids[] }` — phải đủ và đúng các cột hiện có, sai → 409 |
| DELETE | `/columns/{cid}?moveTo=` | |

## Quy trình (`TaskWorkflow`, áp dụng như nhau cho người và BOT)

- Cờ dự án **`Sequential`** ("Đi lần lượt", đổi tên từ `RequireReview`; dự án mới bật): chỉ tiến **1 cột** mỗi lần theo thứ tự; lùi về cột trước bất kỳ nhưng **bắt buộc lý do** (ghi lịch sử + thành bình luận `**A → B:** lý do`). Tắt → kéo tự do.
- Cột `ApproverOnly` luôn áp dụng (kể cả khi tắt đi lần lượt). Lùi từ cột thường thì ai làm việc được cũng lùi được (kèm lý do nếu đi lần lượt).
- Tạo việc: bỏ trống `columnId` = cột đầu. Đi lần lượt → chỉ các cột **trước** cột cần duyệt / hoàn thành đầu tiên; cột cần duyệt luôn chỉ quản lý.
- Chuông `project_task`: tiến vào cột ngay trước một cột cần duyệt → quản lý dự án ("Chờ duyệt"); vào cột cần duyệt → người làm ("Đã duyệt"); lùi kèm lý do → người làm ("Trả lại việc"). Bỏ chính người thao tác.
- **Chuông chung cả dự án** (TEST-32, 2026-11-12, `Domain/TaskNotifyRules.cs`): **tạo việc** ("Việc mới …"), **đổi cột** ("X chuyển … sang "Cột"", có cột cũ → mới + lý do nếu lùi), **bình luận mới** ("X bình luận việc …") → mọi thành viên dự án còn làm, có tài khoản. Bỏ người thao tác và người đã nhận chuông riêng cho cùng sự kiện (giao việc, Chờ duyệt / Đã duyệt / Trả lại, @nhắc) → mỗi người ≤ 1 chuông / sự kiện. Chỉ app, không email. Sửa việc mà không đổi cột → không có chuông chung. Thao tác qua token AI / MCP báo như người thật (MCP gọi chính các endpoint này). Xoá cột kèm chuyển việc (`DELETE /columns/{cid}?moveTo=`) **không** báo. Thành viên là bot nhận cả webhook ([agent-team.md](agent-team.md)).
- API việc: `POST /{id}/tasks`, `PUT /tasks/{tid}` nhận `columnId` (PUT null = giữ); `POST /tasks/{tid}/move { columnId, rank?, note? }`; DTO việc có `columnId, columnName, columnColor, done`; chi tiết việc có `sequential, canApprove, columns`. Tiến độ (`ProgressRules`): `total, done, overdue` (không còn đếm theo Todo/Doing/Review).
- `task_activities` (chỉ thêm): Created (to = tên cột), Moved (from/to = **tên cột** tại thời điểm chuyển; bản ghi trước 2026-11-11 là tên enum `Todo/Doing/Review/Done` — FE đổi ra nhãn), Assigned, DueChanged, Edited.

## BOT + MCP

- **Đội agent** (2026-11-11): token không bao giờ duyệt, giới hạn việc / ngày + chuỗi bot do admin đặt (mặc định 50 / 10), @mã-nhân-viên, việc phụ thuộc (`waitingOn`, "Sẵn sàng") — [agent-team.md](agent-team.md).

- Mọi thay đổi qua token AI / MCP (`ClaimsPrincipal.IsAccessToken()`) → `tasks.CreatedByBot`, `task_comments.ByBot`, `task_activities.ByBot`; FE chip BOT. Bot = tài khoản nhân viên bình thường.
- Tool `update_task_status` / `create_task` / `list_project_tasks` nhận **tên hoặc id cột** (so không phân biệt hoa thường / dấu; bí danh `todo` = cột đầu, `done` / `xong` = cột hoàn thành đầu tiên; tên lạ → lỗi liệt kê các cột). `get_project` / `get_task` trả `columns` + `sequential`.

## Tự cập nhật + toast (2026-11-11)

- `GET /api/projects/activity?after=` (ISO kèm múi giờ; không có → chỉ trả `cursor`): thay đổi ở các dự án người xem thấy được — lịch sử việc (`task_activities`) + bình luận, **bỏ thao tác của chính mình**, ≤ 50 mục, lùi tối đa 1 giờ; `member` = người xem là thành viên. Lý do chuyển lùi (vừa là Moved vừa là bình luận) chỉ trả 1 mục. `cursor` lùi 10 giây (bản ghi lưu muộn không bị sót) → FE bỏ trùng theo `id`. Index `ix_task_activities_time`, `ix_task_comments_time` (migration `ActivityFeedIndexes`). Token AI 403.
- FE `ProjectLiveUpdates` (gắn lazy ở `Header`, không vẽ gì): hỏi mỗi **5 giây khi tab đang mở** (mở lại tab → hỏi ngay) → có thay đổi thì làm mới mọi query `['projects']` (bảng việc, hộp thoại việc, việc của tôi); **toast** chỉ khi `member` và KHÔNG đang ở `/projects/<chính dự án đó>` — > 2 thay đổi / dự án / lần hỏi → gộp 1 toast; nút "Mở" → trang dự án. HR / người xem tài chính (không là thành viên): tự cập nhật, không toast.
- Chọn hỏi định kỳ thay vì đẩy qua Realtime vì Api chưa có địa chỉ Realtime (cần biến `.env` mới). Muốn đẩy tức thì: thêm biến đó rồi Api báo Realtime như `ChatRelay`.

## UI

Kanban cuộn ngang (mỗi cột rộng 18 rem, viền trên + chấm theo màu cột, icon ✓ hoàn thành / khiên cần duyệt). Người có quyền: kéo tiêu đề cột (HTML5 drag, kiểu `text/column`) để sắp xếp, ⚙ mở `ColumnDialog` (tên, 10 màu gợi ý + chọn màu khác, 2 cờ, xoá + chọn cột nhận việc), nút "Thêm trạng thái" trên thanh công cụ (lối vào duy nhất, không còn ô ở cuối bảng). Kéo lùi khi đi lần lượt → hỏi lý do trước. "Việc của tôi" hiện `ColumnBadge` (chấm màu + tên cột).

E2E: `scripts/dev/projects-workflow-e2e.ts` (84 kiểm tra gồm MCP thật, đạt 2026-11-11).
