# Bảng "Màn hình của bot" — tab "File đã sửa" (TEST-100)

> Phần của [office-bots-watch.md](office-bots-watch.md) (hook `use-bot-watch`, bảng `bot-activity-panel`). Về [README.md](README.md). E2E: mục `[100]` của `scripts/dev/bot-watch-e2e.ts` ([e2e.md](../e2e.md)).

Hàng tab dưới đầu bảng: **Hoạt động** (mặc định; đổi bot → về tab này) · **File đã sửa (N)**. `components/bot-file-list/`: `summarizeFiles(events)` + `BotFileList({ files })` — **tính ở FE từ `view.events`** (phiên hiện tại, ≤ 200 sự kiện), không API, không lưu.

- Gộp `file_edit` / `file_write` theo `path`: số lần sửa, tổng dòng `+` / `-` (`diffStat` — cùng quy tắc tô màu, bỏ `+++` / `---`), giờ lần sửa gần nhất; có `file_write` → nhãn "Mới"; lần sửa `ok = false` bỏ qua; không lần nào có `diff` (file nhạy cảm) → vẫn hiện tên + "nội dung ẩn".
- Xếp theo `seq` lần sửa gần nhất (mới nhất trên cùng); file đổi **sau khi mở tab** → dòng nháy nhẹ (`.flash`, tắt khi `prefers-reduced-motion`).
- Bấm một file → mở các diff của file đó theo thứ tự thời gian (`BotDiff` — component diff của dòng thời gian); mỗi lúc mở một file.
- `session_start` mới → hook đã bỏ sự kiện cũ → danh sách trống "Chưa sửa file nào trong phiên này". Cuối tab luôn có ghi chú "Chỉ gồm thay đổi từ lúc bạn bắt đầu xem và 200 thao tác gần nhất".
- Về tab Hoạt động → dòng thời gian bám cuối lại. `data-testid`: `office-bot-tab-log`, `office-bot-tab-files`, `office-bot-files`, `office-bot-files-empty`; dòng `.bot-file[data-path]` > `.bot-file-row`, diff `.bot-file-diffs > div[data-id]`.
