# Dự án: tab Công việc — chế độ xem Danh sách (TEST-192)

> Về [projects-tasks.md](projects-tasks.md) (kanban, cột, quy trình) · [AGENTS.md](../../AGENTS.md). Thiết kế: TEST-191 bản 2 (bình luận "BÀN GIAO THIẾT KẾ (bản 2)").

Chỉ front-end, **không API mới**: dùng dữ liệu `useTasks` mà kanban đã tải (toàn bộ việc của dự án), lọc / nhóm / sắp xếp / tìm ở client, không phân trang.

## Hàng tab + khung (ảnh `danh-sach-trong-v2`)

- Trang chi tiết dự án dùng **tab dạng thẻ** (`ProjectTab` trong `project-detail-page`): vạch `border` dưới cả hàng; tab đang chọn nền `muted` + viền, che vạch để nối liền nội dung; số đếm (việc mở, mốc, thành viên) là nhãn tròn, tab đang chọn đảo màu (`foreground`). "Làm mới" là nút ghost cuối hàng (điện thoại chỉ còn biểu tượng); hàng tab cuộn ngang khi hẹp.
- **Nền tối** (TEST-193, ảnh `may-tinh-toi-v2-review`): không dạng thẻ — tab đang chọn chữ sáng, **gạch chân 2px `primary`** sát đáy (che vạch hàng), nền `muted/40`, không viền / bo thẻ; số đếm tab đang chọn nền `background` chữ `primary`; mọi tab có `border-b-2` trong suốt nên cao bằng nhau; "Làm mới" có viền `border` + nền `muted/40`. Chỉ đổi class `dark:` trong `ProjectTab` — `components/common/tabs.tsx` giữ nguyên.
- Tab Công việc là một khung (`task-panel`, viền, bo đáy): vùng công cụ nền `muted` (Cột / Danh sách, Chỉ việc của tôi, quy trình; ở Danh sách thêm hàng lọc + tìm + Tạo công việc), dưới là kanban hoặc bảng tràn hết chiều ngang, chân "Hiển thị X / Y công việc" nền `muted`. Tab khác giữ nguyên nội dung.

## Chuyển chế độ

- Nút **Cột / Danh sách** đầu hàng công cụ tab Công việc (`ViewToggle` trong `task-board`). Mặc định Cột; lựa chọn nhớ theo trình duyệt ở localStorage `STORAGE_KEY.projectTaskView` (`officehub:projects.taskView`, `config/env.ts`), đọc / ghi bọc try/catch (`readStored` / `writeStored` trong `utils/task-list.ts`).
- "Chỉ việc của tôi" (Checkbox) dùng chung hai chế độ. "Kéo tiêu đề cột…" + "Thêm trạng thái" chỉ ở chế độ Cột. Chế độ Cột không đổi hành vi.
- Hộp thoại chi tiết (`?task=<id>`) và hộp thoại tạo việc vẫn do `TaskBoard` giữ → bấm dòng = bấm thẻ kanban; cập nhật tự động (`project-live-updates` invalidate `projects`) chạy cho cả hai chế độ.

## Danh sách (`components/task-list`)

- Vùng nội dung ≥ 56 rem (`@4xl/content`, container query theo quy tắc layout — không theo cửa sổ): bảng `table-fixed` 7 cột **Việc** (mã, tên, BOT, "Chờ N việc") · **Trạng thái** · **Người làm** · **Theo dõi** · **Hạn** · **Ước lượng** · **Bình luận**. Hẹp hơn (điện thoại, máy tính bảng, cửa sổ hẹp có sidebar): mỗi việc một thẻ nhiều dòng (mã + nhãn | trạng thái, tên, người làm | 👁, hạn | ước lượng + bình luận), không cuộn ngang. Ô tích chọn + thanh thao tác hàng loạt (người có quyền làm việc): [projects-task-bulk.md](projects-task-bulk.md). Không dòng tổng ước lượng, không nút "Cột" ẩn / hiện cột (trùng chữ với nút Cột / Danh sách; bảng cố định 7 cột theo thiết kế).
- Theo dõi: 👁 + `followerCount`, 0 thì trống. Rê chuột → tooltip tên, tải bằng `useTaskDetail` khi tooltip mở (không thêm trường vào API danh sách).
- Hạn: `overdue` → chữ đỏ + nhãn "Quá hạn"; việc `done` gạch ngang tên.
- **Nhóm theo**: Trạng thái (mặc định — thứ tự nhóm = thứ tự cột của dự án, kể cả cột tự đặt; không lọc thì hiện cả nhóm trống) · Người làm (thứ tự thành viên dự án, "Chưa giao" cuối) · Hạn (Quá hạn / 7 ngày tới / Sau đó / Chưa có hạn / Đã xong) · Không nhóm. Nhóm của cột `isDone` (và nhóm "Đã xong") **thu gọn sẵn** — chỉ tiêu đề + số việc; bấm tiêu đề để mở / thu (nhớ trong phiên).
- **Lọc**: Trạng thái (các cột theo thứ tự) · Người làm (Tất cả / Chưa giao / thành viên) · Hạn (Quá hạn / 7 ngày tới — chưa xong / Chưa có hạn) · "Chỉ việc của tôi". **Tìm**: mã + tên, không dấu (`fold`). "Xoá bộ lọc" hiện khi có lọc, xoá cả ô tìm và "Chỉ việc của tôi".
- **Sắp xếp**: Thứ tự bảng (`rank`, như kanban) · Hạn gần nhất · Hạn xa nhất — việc không hạn luôn ở cuối, cùng hạn giữ thứ tự bảng.
- **Đổi trạng thái trên dòng**: nhãn trạng thái (`ColumnBadge` + ▾) mở menu chỉ gồm cột chuyển tới được (`moveBlockReason` — đi lần lượt, cột cần người duyệt khi không `canManage`); lùi khi đi lần lượt → `promptDialog` hỏi lý do (`needsMoveNote`); lưu qua `useMoveTask` (optimistic, lỗi → về cột cũ + toast như kanban). Đang lưu → vòng xoay cạnh nhãn. Không còn cột nào → nhãn tĩnh. Mở menu không mở hộp thoại chi tiết (chặn nổi bọt cả trong portal).
- **Tạo công việc**: mở `TaskDialog` tạo mới ở cột đầu tiên trong `createColumns(...)`; không cột nào tạo được → ẩn nút.
- **Chỉ xem** (`!canWork` hoặc dự án không `Active`, vd thấy dự án nhờ phòng ban): ẩn "Tạo công việc", trạng thái là nhãn tĩnh; bấm dòng vẫn mở chi tiết.
- **Đang tải**: hàng lọc giữ nguyên + dòng skeleton (bảng) / thẻ skeleton (hẹp). **Lỗi tải** (chưa có dữ liệu cũ): khung "Không tải được công việc" + chỉ nút "Thử lại" (`loading` khi đang tải lại). **Trống**: nằm trong khung — vùng rộng vẫn có hàng tiêu đề bảng, giữa là biểu tượng tròn + "Không tìm thấy công việc" + nút chính "Xoá bộ lọc" khi đang lọc, chân vẫn đếm "Hiển thị 0 / Y"; dự án chưa có việc → "Chưa có công việc".

## Mã

`frontend/src/features/projects/utils/task-list.ts` (lọc / nhóm / sắp xếp thuần), `components/task-list/index.tsx`, `components/task-board/index.tsx` (`ViewToggle`, chuyển chế độ). E2E: `scripts/dev/task-list-view-e2e.ts` ([e2e.md](../e2e.md)).
