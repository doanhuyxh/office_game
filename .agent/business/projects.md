# Dự án: thành viên, mốc nghiệm thu, công việc, ngày công (module Projects)

> Nguồn sự thật là code (`backend/src/Modules/Projects/`, `frontend/src/features/projects/`); nếu code khác tài liệu, tin code và sửa tài liệu. Kế hoạch: [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md) giai đoạn 2. Về [README.md](README.md).

Chủ dự án chốt 2026-11-08: **"Dự án" là module riêng**; dev outsource là nhân viên → **ngày công tính theo chấm công** (không ghi giờ theo việc), chia theo % phân bổ; **quản lý dự án chỉ thấy ngày công, không thấy tiền**. **Nhiều hợp đồng / dự án, chốt phân bổ hằng tháng, chi phí nhân công + lãi / lỗ (giai đoạn 2b)**: [projects-finance.md](projects-finance.md). **Yêu cầu thay đổi (CR) + phụ lục HĐ**: [projects-changes.md](projects-changes.md). **Công việc: cột trạng thái tự do, quy trình đi lần lượt / cần người duyệt, BOT**: [projects-tasks.md](projects-tasks.md).

## Tách khỏi module Documents (2026-11-08)

- Trước đây dự án + thành viên nằm ở `documents.projects` / `documents.project_members`. Giờ **module Projects sở hữu**; Documents đọc qua `Projects.Contracts.IProjectDirectory` (`RolesOfAsync`, `ListAsync`, `GetAsync`, `TransferMembershipsAsync` cho bàn giao). Quyền kho dự án không đổi: thành viên đọc / ghi, quản lý dự án quản lý kho, dự án đóng → chỉ đọc, HR toàn quyền.
- `ProjectsMigrator` (đăng ký **sau** DocumentsModule) chép dự án **chưa xoá** + thành viên từ bảng cũ qua `Documents.Contracts.ILegacyDocumentProjects`, **giữ nguyên Id** (kho + mã tài liệu không đổi), loại = Nội bộ, ngày bắt đầu = ngày tạo. Idempotent (chỉ thêm Id chưa có); mã trùng với dự án mới → bỏ qua + log. **Bảng cũ giữ nguyên, Documents không ghi nữa** (có thể xoá ở migration sau khi chắc chắn).
- Bỏ: API `/api/documents/projects*`, tab "Dự án" ở `/documents` (thay bằng nút sang `/projects`), **xoá dự án** (giờ chỉ đóng).

## Quyền (`Infrastructure/ProjectServices.cs` → `ProjectAccess` / `ProjectViewer`)

| | Thấy | Quản lý (sửa, thành viên, mốc, nghiệm thu, phân bổ) | Làm việc (tạo / sửa / kéo việc, bình luận) | Ngày công |
|---|---|---|---|---|
| Thành viên | ✓ | — | ✓ (dự án đang chạy) | — |
| Quản lý dự án | ✓ | ✓ | ✓ | ✓ |
| HR / admin | mọi dự án | ✓ | ✓ | ✓ |
| Quyền **Xem tài chính** (chức vụ) | mọi dự án (chỉ đọc) | — | — | ✓ |
| Người khác | 404 | | | |

**Tạo dự án**: vai trò manager / hr / admin; người tạo (có hồ sơ) = quản lý. Luôn còn ≥ 1 quản lý (bỏ / hạ vai trò người cuối → 409). Xoá việc: quản lý, hoặc người tạo (so Id nhân viên ở hoạt động `Created`, không so tên; còn là thành viên; việc không có lịch sử → chỉ quản lý). **Sửa cột trạng thái**: theo chức vụ (`ManageTaskColumns`) — [projects-tasks.md](projects-tasks.md). Token AI: đọc dự án (+ hướng dẫn) / việc (+ chi tiết, lịch sử) / bình luận / ngày công + tạo / sửa việc (`PUT /tasks/{id}`), chuyển trạng thái, bình luận (tool MCP — [mcp.md](mcp.md)); xoá việc + mọi route khác của `/api/projects` → 403.

## API (`/api/projects`, đăng nhập)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `?mine&status` | HR / Xem tài chính thấy tất cả trừ khi `mine=true`. Kèm đếm việc (mở / xong / quá hạn), mốc, hợp đồng (số, tên, khách — **không tiền**) |
| GET | `/{id}` | Dự án + thành viên + mốc |
| POST / PUT | `/`, `/{id}` | `{ code (≤ 30, chữ không dấu / số / - _, viết hoa, duy nhất; **không đổi sau khi tạo**), name, kind: Internal/Client (Client bắt buộc ≥ 1 `salesContractIds` — một HĐ chỉ một dự án; HĐ **gắn thêm** phải xem được bên Sales — `ISalesContractsLookup.VisibleToAsync`: người phụ trách, cấp quản lý của họ, Xem tài chính; HR / admin không tự có. `GET /sales-contracts` cũng lọc theo quyền này), description?, departmentId?, businessLineId?, startOn? (mặc định hôm nay), endOn?, budgetManDays?, status (PUT), memberIds (POST) }`. Đóng → `ClosedOn` |
| POST / PUT / DELETE | `/{id}/members`, `/{id}/members/{employeeId}` | Thêm (chuông `project_member_added`, link `/projects/{id}`), đổi vai trò, bỏ |
| PUT | `/{id}/allocations` | `{ month, items[{ employeeId, percent \| null }] }` — null = về mặc định; tổng % **đặt tay** của một người ở mọi dự án trong tháng ≤ 100. Tháng đã chốt: chỉ HR / Quản trị tài chính |
| GET | `/{id}/effort` | Từ tháng bắt đầu đến tháng hiện tại / kết thúc / đóng (≤ 24 tháng): mỗi người × tháng = ngày có mặt × % |
| GET | `/sales-contracts?search` · `/sales-contracts/{id}/installments` · `/{id}/installments` | Chọn HĐ bán (manager / HR) · đợt thu của một HĐ / mọi HĐ của dự án mình thấy (không tiền) |
| GET | `/{id}/financials`, `/financials` | Lãi / lỗ — chỉ Xem tài chính ([projects-finance.md](projects-finance.md)) |
| POST / PUT / DELETE | `/{id}/milestones`, `/milestones/{mid}` | Đợt thu phải thuộc một HĐ của dự án, chưa huỷ, chưa gắn mốc khác. Mốc đã nghiệm thu: không xoá, không đổi đợt |
| POST | `/milestones/{mid}/accept` | `{ acceptedOn (≤ hôm nay), note? }` → `ISalesContractsLookup.MarkAcceptedAsync`: hạn đợt thu sau ngày nghiệm thu thì **kéo về ngày nghiệm thu** (đặt lại mốc nhắc), báo kế toán + người phụ trách HĐ (`receivable_due`) |
| GET / POST / PUT / DELETE | `/{id}/columns`, `/columns/{cid}`, `/{id}/columns/order` | Cột trạng thái — [projects-tasks.md](projects-tasks.md) |
| GET / POST | `/{id}/tasks` | `columnId` (bỏ trống = cột đầu). Mã `{MÃ DỰ ÁN}-{n}` (n tăng trong dự án, unique; trùng khi tạo đồng thời → thử lại). Người được giao phải là thành viên; mốc thuộc dự án. `description` = Markdown ≤ 20 000; `mediaLinks` ≤ 20 link http/https ≤ 1000 ký tự (`TaskRules`, bỏ trống / trùng; PUT gửi `null` → giữ nguyên) |
| GET | `/tasks/mine` | Việc chưa xong giao cho tôi, mọi dự án |
| GET | `/tasks/{tid}` | Việc + bình luận + lịch sử (`activities`) + `sequential` + `canApprove` + `columns` |
| PUT / POST / DELETE | `/tasks/{tid}`, `/tasks/{tid}/move` | `move { columnId, rank?, note? }` (kéo thả); PUT cũng nhận `columnId`, `note`. Sai quy trình → 409. Vào cột hoàn thành → `CompletedAt`. Đổi hạn / người → nhắc lại |
| GET / POST | `/tasks/{tid}/comments` | Bình luận → chuông người được giao |

## Quy tắc (`Domain/EffortRules.cs`, test `tests/OfficeHub.Modules.Projects.Tests`)

- **Ngày công** = `TimesheetTotals.PresentDays` (module Attendance, `IAttendanceReports.MonthAsync`) × % phân bổ.
- % mặc định khi chưa đặt tay: số dự án **đang chạy trong tháng** mà người đó là thành viên (theo bắt đầu / kết thúc / ngày đóng) — 1 → 100 %, n → 100 / n. Đặt 0 % = không tính.
- Thành viên tính theo danh sách **hiện tại** ở tháng chưa chốt; tháng đã chốt chỉ tính dòng % đã lưu (job `AllocationFreezeJob` — [projects-finance.md](projects-finance.md)).
- Việc quá hạn: hạn < hôm nay và chưa ở cột hoàn thành (`CompletedAt` null).
- Hạn việc (tạo / sửa) **không được trước hôm nay** (`EffortRules.DueDateError` → 400 `dueOn`; lịch FE khoá ngày đã qua). Sửa việc mà giữ nguyên hạn cũ đã qua vẫn lưu được.

## Quy trình, cột trạng thái, lịch sử, BOT

Chuyển sang [projects-tasks.md](projects-tasks.md). Còn ở dự án: `Project.Sequential` ("Đi lần lượt") + `WorkGuide` (hướng dẫn làm việc Markdown ≤ 20 000, chỉ ở chi tiết; quản lý dự án sửa qua PUT — `null` = giữ, `""` = xoá; tab "Hướng dẫn"; MCP `get_project` trả kèm để bot làm theo).

## Nhắc (`TaskReminderJob`, mỗi giờ, sau 50 s)

Việc chưa xong có người làm, hạn ≤ hôm nay → chuông `project_task` một lần (đổi hạn / người → nhắc lại). Giao việc / bình luận cũng gửi `project_task`.

## Schema `projects` (`ProjectsDbContext`, migration `InitialProjects`)

`projects` (`Code` unique ≤ 30), `contracts` (PK dự án + HĐ bán, `ContractId` unique — migration `ProjectContractsAndFreeze`), `members` (PK dự án + nhân viên, `Role` chuỗi), `allocations` (PK dự án + nhân viên + tháng, `Percent numeric(5,2)`), `allocation_freezes` (PK tháng), `milestones` (`InstallmentId` unique khi có), `task_columns` (index dự án + vị trí, cascade theo dự án), `tasks` (unique dự án + số; `ColumnId` FK Restrict; `MediaLinks text[]` mặc định `{}` — migration `TaskMediaLinks`; index người làm + `CompletedAt`; FK mốc SetNull; `CreatedByBot`), `task_comments` (`ByBot`), `task_activities` (cascade theo việc) — migration `TaskWorkflowAndBot` (+ `projects.RequireReview`, `WorkGuide`), `TaskColumns` (bảng cột, chép dữ liệu, xoá `tasks.State`, đổi tên `RequireReview` → `Sequential`). Không lưu tiền. `Project` có `[Audited]`.

## UI

`/projects` (`ProjectsPage`, `?tab=`): Việc của tôi, thẻ dự án (Của tôi / Tất cả tôi xem được, ẩn dự án đóng; thanh tiến độ + tình trạng + mốc tiếp), **Tổng quan tiến độ** (dự án đang chạy: ô đếm Đúng tiến độ / Có rủi ro / Trễ / việc quá hạn, bảng trễ lên đầu), "Dự án mới" (manager / HR / admin). `/projects/$projectId` (`ProjectDetailPage`, `?tab=`): Công việc (kanban theo cột tự do, kéo thả việc + cột — [projects-tasks.md](projects-tasks.md), lọc việc của tôi, hộp thoại việc gần toàn màn hình (từ `lg`: 2 cột cuộn riêng — trái tên / nội dung / media / bình luận + lịch sử, phải trạng thái / người làm / hạn / ước lượng / mốc / việc phải chờ; header + nút Lưu / Xoá cố định; mobile 1 cột) + bình luận: nội dung Markdown GFM có Viết / Xem trước (`components/common/markdown.tsx`, react-markdown, không render HTML thô), link ảnh / video tự xem trước — ảnh, .mp4/.webm, YouTube, Vimeo, Google Drive (`utils/media.ts`); bình luận cũng hiển thị Markdown) · Mốc (thêm / sửa / nghiệm thu) · Thành viên · Ngày công (bảng tháng × người, sửa % tháng đang chọn, 🔒 tháng đã chốt, thanh ngân sách) · Tài chính (chỉ Xem tài chính). Nút "Tài liệu dự án" → `/documents?space=Project:{id}`.

Tiến độ / tình trạng dự án (tab Tổng quan tiến độ): [projects-progress.md](projects-progress.md).
