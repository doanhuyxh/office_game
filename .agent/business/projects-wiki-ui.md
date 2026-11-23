# Sổ tay dự án — giao diện (TEST-217)

> Về [projects-wiki.md](projects-wiki.md) (API, quyền, giới hạn — TEST-215) · [projects.md](projects.md) · [AGENTS.md](../../AGENTS.md).

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
| `components/wiki-page-view` | Xem trang + nút / menu ⋯ |
| `components/wiki-page-editor` | Soạn / sửa (dùng lại `markdown-editor`), xung đột phiên bản, chặn rời trang |
| `components/wiki-history-sheet` · `wiki-move-dialog` | Lịch sử phiên bản + khôi phục · chuyển trang cha |

## Hành vi

- **Bố cục**: từ container `@4xl/content` 2 cột (trái 16 rem / `@6xl` 18 rem, dính khi cuộn); hẹp → 1 cột, cây thu gọn sau nút "Trang (N) ▾" (chọn trang → tự thu lại);
  đang tìm thì kết quả luôn hiện. 375 px không cuộn ngang.
- **Xem trang**: đường dẫn trang cha (bấm được), tiêu đề, tóm tắt, "Sửa lần cuối bởi … lúc … · phiên bản N" (`BotBadge` khi `updatedByBot`, giờ VN `formatDateTime`),
  nhãn "Đã khoá bởi … lúc …"; có ≥ 2 tiêu đề `##` → mục lục (`markdownHeadings` + `WorkGuideToc`, id tiêu đề tiền tố `wiki`); nội dung `components/common/markdown.tsx`.
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

`scripts/dev/project-wiki-ui-e2e.ts` (Chrome headless, **chỉ DB tạm**, lệnh ở đầu file; Api + Vite, không cần Realtime / Mcp / S3) — 65/65 (2026-11-23): rỗng → tạo gốc + con,
Xem trước, sửa, tìm, link `?page=`, Tổng quan, hai phiên sửa cùng trang, rời trang khi chưa lưu, trang bot (BOT ở trang + lịch sử), quản lý khoá / khôi phục / xoá,
người xem phòng ban, dự án đóng, 375 px + sáng / tối.
