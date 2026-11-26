# Dự án: tải dữ liệu trang chi tiết (TEST-241)

> Về [projects-tasks.md](projects-tasks.md) · danh sách bản gọn [projects-task-list.md](projects-task-list.md) · [architecture.md](../architecture.md). Chỉ front-end.

Prod mỗi lượt API ↔ DB ~30 ms → số request **nối tiếp** quyết định thời gian chờ. Mục tiêu: chi tiết dự án và danh sách việc tải **song song**, cache dùng lại, làm mới hẹp.

## Song song + prefetch

- Route `/projects/$projectId` (`routes/router.tsx`) có `loader` gọi `prefetchProject(queryClient, id, tasks)` (export ở `@/features/projects`): bắt đầu `GET /projects/{id}` + `GET /projects/{id}/tasks?summary=true` ngay khi khớp route, **song song với tải chunk trang**. Không chờ (fire-and-forget), loader không trả dữ liệu — Query giữ quyền độ mới. `tasks` chỉ khi tab Công việc (không `?tab=` / `tab=tasks`) hoặc có `?task=`.
- `ProjectDetailPage` cũng gọi `useTasks(projectId, tab === 'tasks' || !!openTask)` cạnh `useProject` → không còn đợi chi tiết xong mới dựng `TaskBoard` rồi mới gọi; `TaskBoard` dùng lại cùng query. Tab khác: query việc **tắt** (không "đang dùng") → hoạt động mới không tải lại cả danh sách việc khi đang ở sổ tay / mốc…
- `/projects`: rê chuột / focus thẻ dự án → `prefetchProject` + `router.preloadRoute` (chunk trang).
- Chi tiết về trước, việc chưa về → `KanbanSkeleton` (khung kanban giả theo tên / màu / thứ tự cột của `d.columns`, `data-testid="kanban-skeleton"`) thay spinner toàn tab. Chế độ Danh sách giữ skeleton dòng của `TaskList`.

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
