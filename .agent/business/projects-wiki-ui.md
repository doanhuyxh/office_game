# Sổ tay dự án — giao diện (TEST-217)

> Về [projects-wiki.md](projects-wiki.md) (schema, quyền, giới hạn — TEST-215; API: [projects-wiki-api.md](projects-wiki-api.md)) · [projects.md](projects.md) · [AGENTS.md](../../AGENTS.md).

Tab **"Sổ tay"** ở `/projects/$projectId` (`?tab=wiki`, trang đang mở `&page=<id>` — gửi link được; đổi sang tab khác thì bỏ `page`). Hiện với mọi người xem được dự án;
số trang (`project.wikiPages`) là nhãn đếm trên tab. FE **chỉ hiển thị theo cờ API** (`canEdit`, `canManage` của cây / trang, `locked`) — không tự suy quyền.

## Code (`frontend/src/features/projects/`)

| File | Việc |
|---|---|
| `api/wiki.api.ts` | Gọi `/api/projects/{id}/wiki*` + `wikiKeys` — mọi key `['projects', 'wiki', projectId, …]` nên nút "Làm mới" của trang dự án (TEST-150) và lệnh ghi làm mới cả cây / trang / tìm / lịch sử |
| `hooks/useWiki.ts` | `useWikiTree` / `useWikiPage` / `useWikiSearch` / `useWikiVersions` / `useWikiVersion`; `useWikiMutation` (invalidate `wikiKeys.all` + chi tiết dự án vì số trang) |
| `types/wiki.types.ts` · `utils/wiki-tree.ts` | DTO; dựng cây từ danh sách phẳng (`buildWikiTree`, `flattenWikiTree`, `subtreeHeight`, `subtreeIds`) |
| `components/project-wiki` | Khung tab: trái ô tìm + cây + "Trang mới", phải trang đang chọn (xem / sửa / tạo); trạng thái rỗng; chú thích dự án đóng |
| `components/wiki-page-tree` | Cây thu / mở nhánh, 🔒 trang khoá, số trang con ở nhánh đang thu |
| `components/wiki-page-view` | Xem trang + nút / menu ⋯ (xuất `WIKI_HEADING_PREFIX`) |
| `components/wiki-toc-panel` | Bảng mục lục: tay nắm kéo thả, menu / phím chuyển trái-phải, thu gọn, scroll-spy |
| `components/wiki-page-editor` | Soạn / sửa (dùng lại `markdown-editor`), xung đột phiên bản, chặn rời trang |
| `components/wiki-history-sheet` · `wiki-move-dialog` | Lịch sử phiên bản + khôi phục · chuyển trang cha |

## Hành vi

- **Bố cục** (container `@4xl/content`): 3 cột `cây trang (16 rem / `@6xl` 18 rem) | nội dung `minmax(0,1fr)` | mục lục (14 / 16 rem)`. Nội dung **chiếm hết** phần còn lại
  (đã bỏ `max-w-[88rem]`, chữ tràn sát mép theo yêu cầu chủ dự án 2026-11-24). Cây + mục lục dính khi cuộn (`top-20`, cuộn riêng). Hẹp → 1 cột: cây thu gọn sau nút
  "Trang (N) ▾", mục lục là khối `<details>` "Mục lục (N)" ngay trên trang (`wiki-toc-narrow`); đang tìm thì kết quả luôn hiện. 375 px không cuộn ngang.
- **Mục lục** (`wiki-toc-panel`, dùng lại `WorkGuideToc` + `activeId`): chỉ ở chế độ **xem** trang có ≥ 2 tiêu đề `##` (soạn / tạo → ẩn, nội dung mở rộng). Mặc định **cột phải**;
  tô sáng mục đang đọc (scroll-spy `IntersectionObserver`, `aria-current`); bấm → cuộn mượt. **Kéo thả** tay nắm ⠿ (HTML5 DnD, kiểu `application/x-officehub-wiki-toc`) sang vùng thả
  trái / phải (hiện khi đang kéo, `wiki-toc-drop-left|right`); trái = nằm trong rail trái dưới cây trang. Thay thế không cần chuột: menu ⋯ "Chuyển sang trái / phải" +
  phím ← / → khi tay nắm đang focus (HTML5 DnD không chạy trên cảm ứng). Nút tiêu đề thu gọn / mở.
- **Lưu tuỳ chọn mục lục ở server theo tài khoản + dự án** (`tree.prefs` = `tocSide`, `tocCollapsed`; `useWikiPrefs` cập nhật lạc quan trong cache cây, lỗi → hoàn lại + toast;
  `PUT /wiki/prefs` — [projects-wiki-api.md](projects-wiki-api.md)). Đi theo người dùng qua máy khác; mỗi dự án một lựa chọn, mặc định phải / mở.
- **Xem trang**: đường dẫn trang cha (bấm được), tiêu đề, tóm tắt, "Sửa lần cuối bởi … lúc … · phiên bản N" (`BotBadge` khi `updatedByBot`, giờ VN `formatDateTime`),
  nhãn "Đã khoá bởi … lúc …"; có ≥ 2 tiêu đề `##` → mục lục ở cột bên (`markdownHeadings` + `WorkGuideToc`, id tiêu đề tiền tố `wiki`); nội dung `components/common/markdown.tsx`.
- **Nút**: Sửa / Trang con (`canEdit`; Trang con ẩn khi trang đã ở cấp `maxDepth` hoặc đủ `maxPages`), Lịch sử (mọi người xem), ⋯ Đổi tên (`promptDialog`) /
  Chuyển trang cha (hộp chọn bỏ chính trang + con cháu + trang cha làm vượt số cấp, đặt cuối) / Lên trên / Xuống dưới (`canEdit`), Khoá / Mở khoá / Xoá (`canManage`;
  xoá `confirmDialog` destructive — còn trang con → hộp toast lý do server, giữ mở). Người chỉ đọc (phòng ban tham gia, dự án đóng) không thấy nút sửa / menu.
- **Soạn / sửa**: tiêu đề, tóm tắt (một dòng), nội dung Markdown Viết / Xem trước (đếm ký tự / `maxContent`), ghi chú thay đổi; nút Lưu `loading`. Sửa chỉ gửi trường đã đổi
  (`null` = giữ, tóm tắt xoá trắng → `""`) + `baseVersion`. Lỗi theo field (`fieldErrors`) hiện dưới ô.
- **Xung đột (409 có `version`)**: khung cảnh báo "X vừa sửa trang này (phiên bản N, lúc …)", **giữ nguyên bản đang soạn**, nút Lưu khoá; "Xem bản mới nhất" tải trang
  (xem dạng hiển thị / Markdown gốc) → người dùng tự gộp → "Đã gộp — lấy bản N làm gốc" mới cho Lưu lên bản N. Không bao giờ tự ghi đè. 409 khác (dự án đóng…) → toast.
- **Rời trang khi còn chữ chưa lưu** (đổi trang, đổi tab, rời dự án, Huỷ, đóng / tải lại tab): `useBlocker` của TanStack Router + `confirmDialog` "Bỏ nội dung chưa lưu?";
  bấm Huỷ → ở lại, chữ còn nguyên. Lưu xong / Huỷ có xác nhận → không hỏi nữa.
- **Tìm**: ô tìm debounce 300 ms → ≤ 20 trang kèm đoạn trích; bấm → mở trang. Không khớp → "Không có trang nào khớp …".
- **Lịch sử** (sheet): phiên bản mới nhất trước (v, "hiện tại", tiêu đề, người + BOT, giờ, số ký tự, ghi chú), 20 / trang; bấm → xem nội dung bản đó;
  `canManage` → "Khôi phục bản này" (`confirmDialog` + `onConfirm`).
- **Trạng thái rỗng**: lời dẫn sổ tay dùng để làm gì (khác tab Hướng dẫn / kho tài liệu) + "Tạo trang đầu tiên" (chỉ `canEdit`).
- **Dự án đóng**: không `canEdit` → chú thích "Dự án đã đóng — chỉ đọc"; quản lý dự án / HR vẫn sửa như thường.
- **Lối vào**: tab Tổng quan có dòng "Sổ tay → N trang" (bấm sang tab); tab Phụ lục tự có dòng quyền `wiki` / `wikiEdit` / `wikiManage` (API sinh).

## Kiểm thử

`scripts/dev/project-wiki-ui-e2e.ts` (Chrome headless, **chỉ DB tạm**, lệnh ở đầu file; Api + Vite, không cần Realtime / Mcp / S3) — 65/65 (2026-11-23; thêm ca mục lục phải mặc định / menu trái / kéo thả / thu gọn / tải lại 2026-11-24 — chưa chạy lại, Docker tắt): rỗng → tạo gốc + con,
Xem trước, sửa, tìm, link `?page=`, Tổng quan, hai phiên sửa cùng trang, rời trang khi chưa lưu, trang bot (BOT ở trang + lịch sử), quản lý khoá / khôi phục / xoá,
người xem phòng ban, dự án đóng, 375 px + sáng / tối.
