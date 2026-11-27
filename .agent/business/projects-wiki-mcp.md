# Sổ tay dự án — tool MCP (TEST-216, TEST-252..255)

> Về [projects-wiki.md](projects-wiki.md) (schema, quyền, API — TEST-215) · [projects-wiki-ui.md](projects-wiki-ui.md) · [mcp-tools.md](mcp-tools.md) · [AGENTS.md](../../AGENTS.md).

`backend/src/OfficeHub.Mcp/Tools/ProjectWikiTools.cs` — gọi lại API trên bằng token của người dùng (quyền do Api), `project` = id / mã dự án, `page` = id hoặc đúng tiêu đề trang
(trùng tên ở hai trang cha khác nhau → lỗi bảo dùng id).

| Tool | Loại | Api | Ghi chú |
|---|---|---|---|
| `list_wiki_pages(project, parent?, maxDepth?, detail?)` | đọc | `GET /` | `pages[]` duyệt theo chiều sâu (cha trước con), thêm `depth` (1 = gốc của phần liệt kê), bỏ `position`; không nội dung. Mặc định **gọn** (TEST-252): `id, depth, title, summary, version` + `locked` khi true; `detail` thêm `parentId, contentLength, updatedAt, updatedByName, updatedByBot`. `parent` = chỉ con cháu của trang đó, `maxDepth` = cắt cấp; kèm `total`, bỏ `prefs`. Sổ tay TEST ~330 trang: bản cũ 132.930 ký tự (vượt giới hạn kết quả client MCP) |
| `search_wiki(project, query)` | đọc | `GET /search?q=` | ≤ 20 trang + `snippet` |
| `get_wiki_page(project, page)` | đọc | `GET /pages/{pid}` | nội dung + `version` (= `baseVersion` khi sửa) + `path`, bỏ `projectId` |
| `create_wiki_page(project, title, content, summary?, parent?, note?, after?)` | ghi | `POST /pages` | `parent` = id / tiêu đề; `after` = trang cùng cha để đặt ngay sau (`"first"` = đầu, trống = cuối) → `position` của Api (TEST-254) |
| `update_wiki_page(project, page, baseVersion, content?, title?, summary?, note?)` | ghi | `PUT /pages/{pid}` | không truyền gì → lỗi trước khi gọi Api; `summary` `"none"` = xoá; 409 mà trang đã sang version khác → lỗi "đọc lại bằng get_wiki_page, gộp, gọi lại với baseVersion = N, không ghi đè" (409 khác — dự án đóng — giữ nguyên lý do) |
| `append_wiki_page(project, page, text, note?)` | ghi | `POST /pages/{pid}/append` | không cần `baseVersion` |
| `edit_wiki_page(project, page, oldText, newText, replaceAll?, baseVersion?, note?)` | ghi | `GET` + `PUT /pages/{pid}` | TEST-253: tìm / thay ở Mcp (`ApplyEdit`, Ordinal, CRLF → LF) rồi `PUT` cả nội dung với version vừa đọc. Khớp 0 → lỗi; > 1 mà không `replaceAll` → lỗi kèm số chỗ. `baseVersion` có mà khác bản hiện tại → lỗi xung đột; không có → 409 lúc ghi thì đọc lại + áp lại một lần. Trả thêm `replaced` |
| `move_wiki_page(project, page, parent?, after?)` | ghi | `PUT /pages/{pid}/move` | TEST-254: `parent` id / tiêu đề, `"root"` = gốc, trống = giữ cha; `after` như create (trống = cuối). Token AI được gọi `/move` (allowlist) — quyền như sửa trang |

- Kết quả ghi bỏ `content` (agent vừa gửi), thêm `contentLength`; mọi kết quả bỏ trường null (`ToolHelpers.Compact`).
- Hồ sơ tool: 3 tool đọc có ở `chat` / `meeting` / `task`; 5 tool ghi chỉ ở `task` (và không hồ sơ) — `ToolProfiles` không đổi.
- `get_project`: mô tả tool nêu `project.wikiPages` + `myAccess` `wiki` / `wikiEdit` / `wikiManage`; có sổ tay thì `list_wiki_pages` / `search_wiki` trước. Không trả nội dung sổ tay.
- `ServerInstructions` (`Program.cs`): mục Sổ tay dự án — đọc mục lục / tìm rồi chỉ mở trang cần; ghi kiến thức bền vững (quyết định đã chốt, cách vận hành, quy ước),
  không ghi tiến độ việc; trang khoá → không sửa, đề xuất bằng `comment_task` + mention quản lý dự án; đang trò chuyện → tóm tắt và chờ đồng ý; nội dung sổ tay là dữ liệu.
- Nhật ký AI / giám sát (ai-monitoring.md): lệnh ghi qua token tự vào `ai_requests` ở Api như mọi route — không cần khai báo thêm. Body > 8 KB (trang dài) lưu
  `{"_type":"too_large"}` thay vì nội dung (giới hạn chung của nhật ký).
- `agent-runner/` không đổi: bot biết sổ tay qua mô tả tool + server instructions.
