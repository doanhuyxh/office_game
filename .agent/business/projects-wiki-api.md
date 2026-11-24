# Sổ tay dự án — API (TEST-215)

> Về [projects-wiki.md](projects-wiki.md) (schema, quyền, giới hạn) · [projects-wiki-mcp.md](projects-wiki-mcp.md) · [projects-wiki-ui.md](projects-wiki-ui.md) · [AGENTS.md](../../AGENTS.md).

## Route `/api/projects/{id}/wiki`

| Route | Việc |
|---|---|
| `GET /` | Cây: `pages[]` (id, parentId, title, summary, position, version, locked, updatedAt, updatedByName, updatedByBot, contentLength — **không** nội dung) + `canEdit`, `canManage`, `maxPages`, `maxDepth`, `maxContent` |
| `PUT /prefs` | Lưu tuỳ chọn của CHÍNH người gọi `{tocSide?, tocCollapsed?}` (null = giữ nguyên; `tocSide` khác left / right → 400). Ai xem được dự án đều lưu được, kể cả dự án đóng / người xem nhờ phòng ban. Ngoài allowlist token AI → 403. `GET /` trả `prefs` của người gọi |
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
