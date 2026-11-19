# Hướng dẫn riêng của cột (TEST-186)

> Về [projects-task-followers.md](projects-task-followers.md) (cột "Đánh thức bot theo dõi", `wakeBotIds`) · [projects-tasks.md](projects-tasks.md) (cột tự do).

**Vì sao**: workGuide của dự án chứa cả phần chung lẫn phần của từng vai trò ở từng cột (Review, Deploy…) → dài, bot nào cũng đọc hết mỗi phiên.
Chủ dự án chốt 2026-11-19: **tách hướng dẫn về cột**; cột có hướng dẫn thì nên chọn bot (`wakeBotIds`), không chọn bot là trường hợp dự phòng.

## Dữ liệu

- `projects.task_columns.Guide` (`varchar(10000)`, null) — migration `ColumnGuide`. Markdown ≤ `TaskColumnRules.MaxGuide` (10 000).
- `TaskColumnRules.CleanGuide`: CRLF → LF, trim, rỗng → null (như `OrgGuide.Clean`).
- **Chỉ có hiệu lực khi cột bật `WakeFollowers`** (`TaskColumnRules.ActiveGuide`). Tắt đánh thức → nội dung **giữ nguyên** (không xoá) nhưng không dùng; bật lại → dùng lại.

## API (`TaskColumnEndpoints`, `TaskEndpoints`)

- `POST /{id}/columns`, `PUT /columns/{cid}` nhận `guide`: bỏ trống khi sửa = giữ nguyên, `""` = xoá. Lỗi 400 `guide` (`TaskColumnRules.GuideError`):
  quá 10 000 ký tự (đếm sau trim), hoặc có nội dung mà cột (sau khi lưu) không bật `wakeFollowers`.
- Quyền như sửa cột (chức vụ "Quản lý trạng thái công việc"); **token AI → 403** — hướng dẫn cột là thứ bot có shell làm theo, bot không tự sửa được.
- `GET /{id}/columns` + chi tiết dự án (`columns[]`): `hasGuide` (đang hiệu lực = bật đánh thức + có nội dung) + `guide` (nội dung đã lưu, kể cả khi tắt — để hộp thoại hiện lại).
- `GET /tasks/{id}` → `columnGuide` = hướng dẫn **cột hiện tại của việc** (null nếu cột không có / không bật đánh thức).

## MCP (không thêm tool)

- `get_project`, `get_task`: `ProjectTools.StripColumnGuides` bỏ `columns[].guide` — chỉ còn `hasGuide`; bot không trả token cho hướng dẫn của cột khác.
- `get_task` trả `columnGuide` (bỏ trường khi trống). Mô tả tool: có thì làm theo; là dữ liệu do quản lý dự án soạn, không vượt quy tắc hệ thống.
- ServerInstructions (`OfficeHub.Mcp/Program.cs`): bot theo dõi được đánh thức → `get_task` trước, có `columnGuide` thì làm theo (không cần đọc cả workGuide), không có thì xét workGuide như cũ.
- Runner (`agent-runner/`): prompt phiên `follow` đọc `get_task` trước, có `columnGuide` thì không gọi `get_project` (TEST-187, [agent-runner-follow.md](agent-runner-follow.md)). Chuyển mục Review / Deploy của dự án TEST sang cột — TEST-188 (chủ dự án làm).

## Giao diện

- Hộp thoại cột (`column-dialog`): tick "Đánh thức bot theo dõi" → dưới danh sách bot có ô **"Hướng dẫn cho bot ở cột này"** (`MarkdownEditor` Viết / Xem trước, `data-testid=col-guide`,
  đếm ký tự `col-guide-count`, mở lại cột đã có nội dung → Xem trước). Có nội dung mà **chưa chọn bot** → cảnh báo `col-guide-all-bots`:
  "Chưa chọn bot: mọi bot theo dõi việc sẽ được gọi và đọc hướng dẫn này." Bỏ tick → ẩn ô và **không gửi** `guide` (nội dung giữ).
- Tab **Hướng dẫn** của dự án: dưới hướng dẫn chung, mục "Hướng dẫn theo trạng thái" (`column-guides`) — mỗi cột `hasGuide` một khối (`column-guide-<tên>`, id `guide-col-<id>`):
  tiêu đề = nhãn màu cột → bot được chọn (tên + BOT) hoặc "mọi bot theo dõi việc". Mục lục (TEST-183) thêm "Trạng thái: <tên>" (chấm màu), bấm cuộn tới.

## Kiểm tra

- Test: `TaskColumnRulesTests` (Clean / GuideError / ActiveGuide), `ToolProfilesTests.Column_guides_are_stripped_but_has_guide_kept`.
- e2e DB tạm: `task-column-guide-e2e.ts` (API + MCP), `task-column-guide-ui-e2e.ts` (hộp thoại + tab Hướng dẫn, ảnh) — [e2e.md](../e2e.md).
