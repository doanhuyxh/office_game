# Dự án: tải dữ liệu trang chi tiết (TEST-241)

> Về [projects-tasks.md](projects-tasks.md) · danh sách bản gọn [projects-task-list.md](projects-task-list.md) · [architecture.md](../architecture.md). Chỉ front-end.

Prod mỗi lượt API ↔ DB ~30 ms → số request **nối tiếp** quyết định thời gian chờ. Mục tiêu: chi tiết dự án và danh sách việc tải **song song**, cache dùng lại, làm mới hẹp.

## Song song + prefetch

- Route `/projects/$projectId` (`routes/router.tsx`) có `loader` gọi `prefetchProject(queryClient, id, tasks)` (export ở `@/features/projects`): bắt đầu `GET /projects/{id}` + `GET /projects/{id}/tasks?summary=true` ngay khi khớp route, **song song với tải chunk trang**. Không chờ (fire-and-forget), loader không trả dữ liệu — Query giữ quyền độ mới. `tasks` chỉ khi tab Công việc (không `?tab=` / `tab=tasks`) hoặc có `?task=`.
- `ProjectDetailPage` cũng gọi `useTasks(projectId, tab === 'tasks' || !!openTask)` cạnh `useProject` → không còn đợi chi tiết xong mới dựng `TaskBoard` rồi mới gọi; `TaskBoard` dùng lại cùng query. Tab khác: query việc **tắt** (không "đang dùng") → hoạt động mới không tải lại cả danh sách việc khi đang ở sổ tay / mốc…
- `/projects`: rê chuột / focus thẻ dự án → `prefetchProject` + `router.preloadRoute` (chunk trang).
- Chi tiết về trước, việc chưa về → `KanbanSkeleton` (khung kanban giả theo tên / màu / thứ tự cột của `d.columns`, `data-testid="kanban-skeleton"`) thay spinner toàn tab. Chế độ Danh sách giữ skeleton dòng của `TaskList`.

## Hộp thoại việc (TEST-242)

- Danh sách là bản gọn (TEST-240) → mô tả / media / người theo dõi / việc phải chờ / lịch sử lấy từ `useTaskDetail` (`GET /tasks/{tid}?comments=false`). Chưa về: phần có từ danh sách (tên, trạng thái, người làm, hạn, ước lượng, mốc) hiện ngay; phần còn lại là **khung xương cùng cỡ** (`task-desc-skeleton` cao ≈ ô Markdown 10 dòng, `task-media-skeleton` theo `mediaCount`, `task-followers-skeleton` / `task-dependencies-skeleton` theo `followerCount` / `waitingOn` + ô chọn nếu sửa được, `task-history-skeleton`); Lưu + sửa mô tả / link khoá.
- Khởi tạo form khi mở + điền mô tả / link khi chi tiết về đặt state **ngay khi render** (so `openKey` / `filledFor`, mẫu "điều chỉnh state khi prop đổi"), không qua `useEffect` → không có khung hình form của việc trước / mô tả rỗng / đổi chế độ xem–sửa. Điền **một lần** mỗi lần mở: refetch sau đó và tên gõ trong lúc chờ không bị ghi đè.
- Đã có cache → hiện ngay, không khung xương. Rê chuột / focus thẻ kanban hoặc dòng Danh sách ≥ 150 ms → `prefetchTask` (staleTime 30 giây cho lần tải trước; `useTaskDetail` vẫn staleTime 0, làm mới nền khi mở). Lướt nhanh qua bảng không bắn request.
- Lỗi tải chi tiết (500, mạng) → vùng mô tả "Không tải được chi tiết việc" + Thử lại, hết khung xương, Lưu vẫn khoá. `TaskBoard` chỉ đóng hộp thoại + "Không tìm thấy việc" khi lỗi 4xx hoặc việc không có trong danh sách (link `?task=`).
- Tạo việc mới: form trống như cũ, không khung xương. e2e `scripts/dev/task-dialog-skeleton-e2e.ts` (Slow 4G, ghi mọi trạng thái DOM của hộp thoại bằng MutationObserver).

## Cache

- `projectDetailQuery(id)` / `projectTasksQuery(id)` (`hooks/useProjects.ts`, `queryOptions`) dùng chung cho hook, loader, prefetch; `staleTime` `PROJECT_STALE_MS` = 30 giây: quay lại trang / dự án trong 30 giây hiện cache, không gọi; quá 30 giây hiện cache + làm mới nền.
- Lệnh ghi của mình vẫn làm mới ngay (`useProjectMutation` invalidate `['projects']`, `useMoveTask` khoá hẹp, gồm `projectKeys.task(tid)`) — invalidate bỏ qua `staleTime`.

## Làm mới khi người khác thay đổi (`ProjectLiveUpdates`)

Hỏi `/api/projects/activity` mỗi 5 giây như cũ; có hoạt động mới → chỉ invalidate (`liveUpdateKeys`):
- mỗi dự án có hoạt động: `detail(id)` (đếm / tiến độ) + `tasks(id)`;
- mỗi việc có hoạt động: `task(tid)` + `comments(tid)`;
- `myTasks` + `['projects','list']` (đếm việc / tiến độ ở /projects);
- hộp thoại việc **đang mở** của dự án đó (query `task` có observer, `data.task.projectId` khớp) — vd việc nó chờ vừa xong / đổi phụ thuộc.

Không còn invalidate cả `['projects']` (trước đây kéo theo sổ tay, ngày công, tài chính, phụ lục, CR…). Nút "Làm mới" của trang vẫn đánh dấu cũ mọi query của dự án.

## Đo (e2e `scripts/dev/project-detail-parallel-e2e.ts`, DB tạm 240 việc, Fast 4G, không cache, `vite preview`)

- Trước: `/tasks` bắt đầu sau `/projects/{id}` ~204 ms (nối tiếp), thấy kanban ~1728 ms (trung vị 5 lần).
- Sau: hai request bắt đầu cách nhau 1–2 ms (chồng nhau), thấy kanban ~1220 ms.
- Back-end `GetAsync` không đổi (mục 6 của việc là tuỳ chọn).
