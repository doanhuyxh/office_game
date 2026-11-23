# Sổ tay dự án (wiki) — TEST-215

Tài liệu chữ ở phạm vi **toàn dự án** cho người và agent cùng tham khảo: nhiều trang Markdown lưu DB, theo cây, có lịch sử phiên bản, agent đọc / ghi **từng trang**
(chủ dự án chốt 2026-11-23). Khác với:

- **Hướng dẫn làm việc** (`projects.WorkGuide`, một ô ≤ 20 000 ký tự, `get_project` trả cả khối): luật làm việc ngắn — giữ nguyên vai trò.
- **Kho tài liệu** (module Documents, file S3, ban hành / số hiệu / hạn lưu trữ): file chính thức — giữ nguyên vai trò.

Back-end: `Domain/WikiRules.cs` (quy tắc thuần, test `WikiRulesTests`), `Features/WikiEndpoints.cs`, entity `WikiPage` / `WikiPageVersion` trong `Domain/Entities.cs`.
Phần tiếp: TEST-216 (tool MCP), TEST-217 (tab "Sổ tay" trên web).

## Schema (`projects`, migration `ProjectsWiki`)

- `wiki_pages`: `Id`, `ProjectId` (FK restrict → `projects`), `ParentId` (FK restrict → chính nó; null = gốc), `Title` ≤ 200, `Summary` ≤ 300 (một dòng, null được),
  `Content` (Markdown ≤ 50 000), `Version` (tăng mỗi lần lưu có thay đổi), `Position` (thứ tự trong cùng cha, 0..n), `Locked` + `LockedByName` / `LockedAt`,
  `Created*` / `Updated*` (`At`, `ByEmployeeId`, `ByName`, `ByBot`), `DeletedAt` + `DeletedByName` (xoá mềm). Index `ix_wiki_pages_tree` (ProjectId, ParentId, Position).
- `wiki_page_versions`: `PageId` (FK cascade), `Version`, `Title`, `Summary`, `Content`, `EditedAt`, `EditedByEmployeeId`, `EditedByName`, `EditedByBot`, `Note` ≤ 300.
  Unique `ux_wiki_page_versions_page_version` (PageId, Version) — cũng là khoá chống hai lần lưu cùng lúc. Giữ **mọi** phiên bản; phiên bản 1 = lúc tạo.
- Tên trang không trùng trong cùng cha (không phân biệt hoa thường, bỏ trang đã xoá) — kiểm ở endpoint (gốc có `ParentId` null nên không dùng unique index).

## Quyền (`WikiRules`)

| Ai | Được |
|---|---|
| Người xem được dự án (`CanSee` — gồm người xem nhờ phòng ban tham gia, quyền Xem tài chính) | Đọc cây, trang, lịch sử, phiên bản, tìm |
| Thành viên — người và bot (`CanWork`) | Tạo, sửa, nối thêm, di chuyển / sắp xếp trang **chưa khoá** |
| Quản lý dự án, HR / admin (`CanManage`) | Thêm: xoá trang, khoá / mở khoá, khôi phục phiên bản, sửa trang đã khoá |

- Không xem được dự án → **404** mọi route. Không phải thành viên mà ghi → 403 `Chỉ thành viên dự án được sửa sổ tay`.
- **Trang đã khoá**: chỉ quản lý dự án / HR **trên web** sửa; thành viên thường và token AI → 403 `Trang đã khoá — …`.
- **Dự án đã đóng**: dùng lại `ClosedProjectRules.TaskWriteError` (TEST-213, [projects-closed.md](projects-closed.md)) — thành viên chỉ đọc (409
  `Dự án đã đóng — bạn chỉ bình luận được`), token AI 409, quản lý dự án + HR trên web vẫn sửa / khoá / xoá / khôi phục. Mở lại → như cũ.
- **Token AI** (bot sửa trực tiếp, không qua duyệt): đọc cây / tìm / trang, tạo, sửa, nối thêm — ghi `CreatedByBot` / `UpdatedByBot` / `EditedByBot` = true (nhãn BOT).
  **Không** xoá, khoá, khôi phục, di chuyển, xem lịch sử (ngoài allowlist `AccessTokenAuth` → 403; endpoint cũng tự chặn xoá / khoá / khôi phục qua token).
- Cờ trên DTO (`canEdit`, `canManage`) tính bằng `WikiRules.Flags` (đã xét dự án đóng, token, trang khoá) — FE / MCP chỉ dùng để hiện nút.
- Phụ lục quyền hạn (`ProjectPermissions`, `myAccess`): thêm `wiki` (đọc), `wikiEdit` (sửa), `wikiManage` (quản lý).

## Giới hạn (hằng số trong `WikiRules`)

Nội dung ≤ 50 000 ký tự / trang (400), cây sâu ≤ 4 cấp (gốc = cấp 1; 400 khi tạo / di chuyển, tính cả chiều cao cây con), ≤ 500 trang chưa xoá / dự án (409),
tóm tắt ≤ 300, tiêu đề ≤ 200, ghi chú ≤ 300. Tiêu đề / tóm tắt gộp xuống dòng thành dấu cách; nội dung CRLF → LF.
Lưu mà tiêu đề + tóm tắt + nội dung không đổi → **không** tạo phiên bản (trả trang hiện tại).

## API (`/api/projects/{id}/wiki`)

| Route | Việc |
|---|---|
| `GET /` | Cây: `pages[]` (id, parentId, title, summary, position, version, locked, updatedAt, updatedByName, updatedByBot, contentLength — **không** nội dung) + `canEdit`, `canManage`, `maxPages`, `maxDepth`, `maxContent` |
| `GET /search?q=` | ILIKE (`Like.Contains`, `%` `_` là ký tự thường) trong tiêu đề + tóm tắt + nội dung; khớp tiêu đề lên đầu rồi mới sửa trước; ≤ 20 kết quả kèm `snippet` (±80 ký tự quanh chỗ khớp, gộp khoảng trắng, "…") |
| `GET /pages/{pageId}` | Trang đầy đủ + `version` + `canEdit` / `canManage` + `path` (các trang cha từ gốc) |
| `POST /pages` | Tạo `{title, summary?, content?, parentId?, note?}` → 201, version 1, cuối danh sách của cha |
| `PUT /pages/{pageId}` | Sửa `{baseVersion, title?, summary?, content?, note?}` (null = giữ nguyên, `summary: ""` = xoá). `baseVersion` ≠ hiện tại → **409** kèm `version`, `updatedByName`, `updatedAt`, `updatedByBot`, không ghi đè. Hai người lưu cùng lúc → unique index → 409 |
| `POST /pages/{pageId}/append` | Nối `{text, note?}` vào cuối (cách một dòng trống), không cần `baseVersion`, vẫn tạo phiên bản; trùng phiên bản → thử lại một lần trên bản mới |
| `PUT /pages/{pageId}/move` | `{parentId, position}`: không làm con của chính nó / con cháu, ≤ 4 cấp, tên không trùng ở cha mới; đánh lại `Position` 0..n ở cha cũ + mới. Không tạo phiên bản |
| `GET /pages/{pageId}/versions?page=&pageSize=` | Lịch sử mới nhất trước (≤ 100 / trang, không nội dung) `{items, total, page, pageSize}` · `GET …/versions/{n}` một bản đủ nội dung |
| `POST /pages/{pageId}/versions/{n}/restore` | Quản lý: tạo phiên bản mới từ bản `n` (ghi chú "Khôi phục phiên bản n"); trùng nội dung hiện tại → không tạo; tên cũ trùng trang khác cùng cha → 409 |
| `POST /pages/{pageId}/lock` · `/unlock` | Quản lý: 204 (lặp lại cũng 204) |
| `DELETE /pages/{pageId}` | Quản lý: xoá mềm, chỉ khi không còn trang con (409), đánh lại thứ tự các trang cùng cha |

DTO dự án (`GET /api/projects`, `/{id}`): `wikiPages` = số trang chưa xoá. Không có sự kiện thông báo (không đụng `NotificationCatalog`).

## Kiểm thử

- `WikiRulesTests` (quyền theo vai trò / token / khoá / dự án đóng, giới hạn, cây, chèn thứ tự, đoạn trích), `ProjectDepartmentAccessTests` (myAccess từng vai trò),
  `AccessTokenScopeTests` (route mở / chặn cho token).
- E2E `scripts/dev/project-wiki-e2e.ts` — **chỉ DB tạm** (không cần S3), lệnh ở đầu file — 80/80 (2026-11-23).
