# Dự án: thao tác hàng loạt trên công việc

> Về [projects-tasks.md](projects-tasks.md) (kanban, quy trình) · [projects-task-list.md](projects-task-list.md) (chế độ Danh sách) · [AGENTS.md](../../AGENTS.md). Chủ dự án chốt 2026-11-25.

Chọn nhiều việc ở tab Công việc (**cả Danh sách lẫn kanban**) rồi làm một lượt: chuyển trạng thái, giao người, đổi hạn, thêm / bỏ người theo dõi, xoá.
**Chỉ web** — token AI / MCP không gọi được (ngoài allowlist `AccessTokenAuth` + endpoint chặn thẳng 403); bot đã có tool từng việc nên **không đổi MCP / catalog**.

## API — `POST /api/projects/{id}/tasks/bulk` (`BulkTaskEndpoints`, quy tắc thuần `Domain/BulkTaskRules`)

Body `{ taskIds[], action, … }` — `action` + trường đi kèm:

| `action` | Trường | Gọi handler đơn lẻ |
|---|---|---|
| `move` | `columnId`, `note?` (lý do lùi, dùng chung cả loạt) | `TaskEndpoints.MoveAsync` |
| `assign` | `assigneeEmployeeId` (null = bỏ giao) | `UpdateAsync` với bản `UpsertTask` giữ nguyên mọi trường khác |
| `due` | `dueMode` = `set` (+`dueOn`) / `clear` / `shift` (+`shiftDays` ≠ 0, ±365, âm = lùi) | `UpdateAsync` |
| `follow` · `unfollow` | `followerEmployeeId` | `TaskFollowerEndpoints.AddAsync` / `RemoveAsync` |
| `delete` | `confirm` = chữ `delete` (không phân biệt hoa thường) | `DeleteAsync` |

- **Mỗi việc đi qua đúng handler đơn lẻ** → quyền (`CanWork` / xoá: người tạo hoặc quản lý dự án), quy trình (đi lần lượt, cột cần duyệt, lùi cần lý do), dự án đóng (chỉ quản lý dự án / HR), lịch sử `task_activities`, đánh thức bot theo dõi, thông báo "Sẵn sàng" — **thông báo vẫn từng việc như thao tác tay** (chủ dự án chốt, không gộp; không đụng `NotificationCatalog`).
- **Thành công từng phần**, không một transaction: trả `{ applied[], skipped[{ taskId, code, reason }] }`. Việc lỗi (sai quy trình, thiếu quyền, người được giao không phải thành viên, dời hạn khi chưa có hạn, hạn quá khứ…) bỏ qua kèm lý do, việc khác vẫn làm. Đã đúng sẵn (cùng cột, cùng hạn, đã theo dõi) → coi như áp dụng, không lỗi. `db.ChangeTracker.Clear()` sau mỗi việc.
- Lỗi cấu trúc → 400 (thao tác lạ, 0 hoặc > `BulkTaskRules.MaxIds` = 100 việc, thiếu cột / người / ngày, `shiftDays` 0, `confirm` ≠ `delete` khi xoá). Không xem được dự án → 404. Id không thuộc dự án / đã xoá → `skipped` ("Việc không thuộc dự án này").
- Test: `BulkTaskRulesTests`; e2e `scripts/dev/task-bulk-e2e.ts` (chỉ Api, DB tạm, [e2e.md](../e2e.md)).

## Giao diện (`features/projects/`)

| File | Việc |
|---|---|
| `components/kanban-task-card` | Thẻ việc kanban + ô tích chọn trong thẻ |
| `components/task-bulk-bar` | Thanh dính đáy khung tab: "Đã chọn N việc · Bỏ chọn", Chuyển trạng thái, Giao cho, Đổi hạn, Theo dõi ▾ (thêm / bỏ), ⋯ Xoá; giữ ca "một phần": việc đã làm bỏ chọn, việc bỏ qua giữ chọn |
| `components/task-bulk-dialog` | Hộp thoại 5 thao tác; **xem trước** chuyển trạng thái ở FE (`movePlan` = `moveBlockReason` của kanban: "N chuyển được · M bỏ qua" + lý do), ô lý do khi có việc lùi, đổi hạn 3 cách (đặt / dời N ngày / xoá, báo số việc chưa có hạn) |
| `components/task-bulk-delete-dialog` | Xoá: cảnh báo không hoàn tác, liệt kê việc, **phải gõ tay `delete`** mới bật nút (back-end kiểm lại) |
| `components/task-bulk-result-dialog` | Có việc bị bỏ qua → liệt kê mã + lý do |
| `utils/task-bulk.ts` | Hàm thuần: `movePlan`, `rangeIds` (Shift+click), `withIds`, `checkState`, hằng khớp back-end |
| `hooks/useProjects.ts` | `useBulkTasks` (làm mới như mọi lệnh ghi dự án) |

- **Chọn**: tập chọn ở `TaskBoard` dùng chung hai chế độ. Danh sách: cột ô tích đầu bảng (thẻ ở màn hẹp), ô tiêu đề = tất cả dòng đang hiện (nhóm thu gọn không tính, có trạng thái "một phần"), ô ở tiêu đề nhóm = cả nhóm, Shift+click chọn dải. Kanban (`components/kanban-task-card`): ô tích nhỏ 16 px nằm **trong** thẻ, cuối dòng đầu (dòng đầu chừa `pr-6` nên không nhảy bố cục), hiện khi rê chuột / khi đã có việc được chọn / màn cảm ứng, là phần tử anh em của nút thẻ (không lồng nút trong nút); thẻ đã chọn: nền `primary/5`, viền `primary/50` + vạch dọc 3 px `primary` mép trái. Chọn cả cột: nút biểu tượng ☑ / ▣ / ☐ (không / một phần / cả cột) trong cụm nút bên phải tiêu đề cột, cùng kiểu với sắp xếp / cài đặt.
- **Thẻ kanban**: dòng đầu mã + BOT; tên việc; dòng cuối chip chữ cái đầu + tên người làm (chưa giao: chữ nghiêng), chip "⏳ Chờ N việc", rồi hạn / ước lượng / bình luận / ảnh dồn phải (quá hạn chữ đỏ). Khối bọc và thẻ đều `w-full` (trước đây thẻ có ô tích bị hẹp hơn).
- **Gắn với bộ lọc**: đổi lọc / tìm / "Chỉ việc của tôi" hoặc việc bị xoá → bỏ chọn việc không còn hiện (`keepOnly`). Chỉ `canWork` thấy ô tích.
- Kéo thẻ kanban vẫn chỉ chuyển một thẻ.
