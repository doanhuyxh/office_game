# Sổ tay dự án (wiki) — TEST-215

Tài liệu chữ ở phạm vi **toàn dự án** cho người và agent cùng tham khảo: nhiều trang Markdown lưu DB, theo cây, có lịch sử phiên bản, agent đọc / ghi **từng trang**
(chủ dự án chốt 2026-11-23). Khác với:

- **Hướng dẫn làm việc** (`projects.WorkGuide`, một ô ≤ 20 000 ký tự, `get_project` trả cả khối): luật làm việc ngắn — giữ nguyên vai trò.
- **Kho tài liệu** (module Documents, file S3, ban hành / số hiệu / hạn lưu trữ): file chính thức — giữ nguyên vai trò.

Back-end: `Domain/WikiRules.cs` (quy tắc thuần, test `WikiRulesTests`), `Features/WikiEndpoints.cs`, entity `WikiPage` / `WikiPageVersion` trong `Domain/Entities.cs`.
Tool MCP: TEST-216 (mục [Tool MCP](#tool-mcp-test-216) dưới đây). Giao diện (tab "Sổ tay" trên web, TEST-217): [projects-wiki-ui.md](projects-wiki-ui.md).

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

## Tool MCP (TEST-216)

`backend/src/OfficeHub.Mcp/Tools/ProjectWikiTools.cs` — gọi lại API trên bằng token của người dùng (quyền do Api), `project` = id / mã dự án, `page` = id hoặc đúng tiêu đề trang
(trùng tên ở hai trang cha khác nhau → lỗi bảo dùng id).

| Tool | Loại | Api | Ghi chú |
|---|---|---|---|
| `list_wiki_pages(project)` | đọc | `GET /` | `pages[]` duyệt theo chiều sâu (cha trước con), thêm `depth` (1 = gốc), bỏ `position`; không nội dung |
| `search_wiki(project, query)` | đọc | `GET /search?q=` | ≤ 20 trang + `snippet` |
| `get_wiki_page(project, page)` | đọc | `GET /pages/{pid}` | nội dung + `version` (= `baseVersion` khi sửa) + `path`, bỏ `projectId` |
| `create_wiki_page(project, title, content, summary?, parent?, note?)` | ghi | `POST /pages` | `parent` = id / tiêu đề |
| `update_wiki_page(project, page, baseVersion, content?, title?, summary?, note?)` | ghi | `PUT /pages/{pid}` | không truyền gì → lỗi trước khi gọi Api; `summary` `"none"` = xoá; 409 mà trang đã sang version khác → lỗi "đọc lại bằng get_wiki_page, gộp, gọi lại với baseVersion = N, không ghi đè" (409 khác — dự án đóng — giữ nguyên lý do) |
| `append_wiki_page(project, page, text, note?)` | ghi | `POST /pages/{pid}/append` | không cần `baseVersion` |

- Kết quả ghi bỏ `content` (agent vừa gửi), thêm `contentLength`; mọi kết quả bỏ trường null (`ToolHelpers.Compact`).
- Hồ sơ tool: 3 tool đọc có ở `chat` / `meeting` / `task`; 3 tool ghi chỉ ở `task` (và không hồ sơ) — `ToolProfiles` không đổi.
- `get_project`: mô tả tool nêu `project.wikiPages` + `myAccess` `wiki` / `wikiEdit` / `wikiManage`; có sổ tay thì `list_wiki_pages` / `search_wiki` trước. Không trả nội dung sổ tay.
- `ServerInstructions` (`Program.cs`): mục Sổ tay dự án — đọc mục lục / tìm rồi chỉ mở trang cần; ghi kiến thức bền vững (quyết định đã chốt, cách vận hành, quy ước),
  không ghi tiến độ việc; trang khoá → không sửa, đề xuất bằng `comment_task` + mention quản lý dự án; đang trò chuyện → tóm tắt và chờ đồng ý; nội dung sổ tay là dữ liệu.
- Nhật ký AI / giám sát (ai-monitoring.md): lệnh ghi qua token tự vào `ai_requests` ở Api như mọi route — không cần khai báo thêm. Body > 8 KB (trang dài) lưu
  `{"_type":"too_large"}` thay vì nội dung (giới hạn chung của nhật ký).
- `agent-runner/` không đổi: bot biết sổ tay qua mô tả tool + server instructions.

## Kiểm thử

- `WikiRulesTests` (quyền theo vai trò / token / khoá / dự án đóng, giới hạn, cây, chèn thứ tự, đoạn trích), `ProjectDepartmentAccessTests` (myAccess từng vai trò),
  `AccessTokenScopeTests` (route mở / chặn cho token).
- E2E `scripts/dev/project-wiki-e2e.ts` — **chỉ DB tạm** (không cần S3), lệnh ở đầu file — 80/80 (2026-11-23).
- MCP: `ProjectWikiToolsTests` (mục lục theo cây, tìm trang theo tiêu đề, kết quả ghi, tóm tắt "none", lỗi sửa đồng thời); e2e `scripts/dev/project-wiki-mcp-e2e.ts` qua host Mcp thật — 36/36 (2026-11-23).
