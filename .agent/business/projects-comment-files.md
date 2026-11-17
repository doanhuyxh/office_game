# Ảnh / tệp đính kèm bình luận việc (TEST-153)

> Về [projects-tasks.md](projects-tasks.md) · MCP [mcp-tools.md](mcp-tools.md) · e2e [../e2e.md](../e2e.md)

Người thật dán / kéo-thả / chọn ảnh, tệp vào bình luận việc trên web; bot gửi ảnh báo cáo (vd ảnh chụp kết quả) và xem ảnh của nhau qua MCP. Module Projects có **bản riêng** (không tham chiếu Chat — ranh giới module), cùng giới hạn như chat.

## Quy tắc (`Domain/CommentFileRules.cs`)

- Ảnh (jpg / png / webp / gif) ≤ **10 MB**, tệp khác ≤ **25 MB**; chặn đuôi chạy chương trình (.exe, .bat, .apk, .sh…), đuôi phải nằm trong `FileTypes` (MIME do server suy từ đuôi, không tin trình duyệt). SVG / HTML luôn tải về (không inline).
- ≤ **5 tệp** / bình luận; bình luận **chỉ có tệp** (nội dung rỗng) được phép; nội dung ≤ 3 000 ký tự (`TaskRules.MaxComment`).
- Token AI: ≤ **30 tệp / giờ** (vé còn treo + tệp đã gắn vào bình luận BOT) → 429.
- Chủ dự án chốt: **chỉ lưu khoá S3**, không lưu base64. Khoá `projects/comments/{yyyy}/{MM}/{vé}/{tên an toàn}`. Link xem = presigned GET cấp **mỗi lần đọc** (web 60 phút, AI 10 phút).

## Schema `projects` (migration `TaskCommentAttachments`)

- `comment_attachments`: `Id`, `CommentId` (FK cascade → `task_comments`), `FileKey`, `FileName` (300), `ContentType` (150), `Size`, `IsImage`; index `ix_comment_attachments_comment`.
- `comment_upload_tickets`: vé đã xin link PUT chưa gắn bình luận — `TaskId`, `UserId`, `ByBot`, `FileKey`, `FileName`, `ContentType`, `Size`, `CreatedAt`; index thời gian + (UserId, CreatedAt). Vé > 24 giờ bị dọn (xoá cả file mồ côi, key chính + key tạm `uploads/`) mỗi lần xin vé mới (`UploadCleanup.PurgeAsync`).

## API (`Features/CommentFileEndpoints.cs`, `TaskEndpoints.cs`)

| Route | Quyền | Ghi chú |
|---|---|---|
| `POST /api/projects/tasks/{tid}/uploads` `{fileName, contentType?, size}` | thành viên dự án đang chạy (như bình luận) | → `{id, url (PUT presigned 30 phút, key tạm), contentType, expiresAt}`; PUT với đúng `Content-Type` trả về |
| `POST /api/projects/tasks/{tid}/comments` `{content?, uploadIds?}` | như cũ | vé phải của chính người gửi + cùng việc; chép key tạm → key chính + kiểm chữ ký đầu file (`PromoteUploadAsync`, TEST-13); chưa PUT → 409; vé lạ / của người khác / đã dùng → 400 |
| `CommentDto.attachments` | người xem được dự án | `[{id, fileName, contentType, size, isImage, url}]` theo thứ tự tải lên |
| `GET /api/projects/comment-attachments/{id}` | người xem được dự án (không → 404) | thông tin + link 10 phút (tool `view_attachment`) |
| `GET /api/projects/comment-attachments/{id}/preview?max=` | như trên | JPEG cạnh dài ≤ 1280 (`ImageThumbnail`), `no-store`; không phải ảnh 400, ảnh hỏng 422 |

- Token AI được gọi `POST …/uploads` và `GET /comment-attachments/{id}(/preview)` (`AccessTokenAuth`); không có link 60 phút của web.
- **Xoá bình luận** (chỉ người viết, web) / **xoá việc** → xoá dòng DB (cascade) rồi xoá file S3 (lỗi S3 bỏ qua — file lẻ không ai trỏ tới).
- Chuông / luồng thay đổi: bình luận chỉ có tệp → xem trước "[Ảnh] tên" (+N) / `/activity` hiện "[Ảnh / tệp đính kèm]".

## Web (`features/projects`)

- `task-comment-input`: nút kẹp giấy (chọn nhiều tệp), dán ảnh Ctrl+V, kéo-thả vào ô (lớp phủ "Thả ảnh / tệp để đính kèm"); chip xem trước (ảnh thu nhỏ / icon, tên, dung lượng, nút ×); kiểm tra sớm ở client (`utils/attachments.ts`: cỡ, đuôi chặn, tối đa 5 — server vẫn kiểm). Tải lên khi bấm gửi (xin vé → PUT S3 → đăng); nút gửi `loading` suốt cả chuỗi.
- `comment-attachments`: ảnh = ô 96px, bấm mở `ImageViewer` dùng chung (lướt mọi ảnh của bình luận, chú thích "người viết · giờ"); tệp khác = chip tên + dung lượng, tải về.

## MCP

- `create_upload(target = task-comment, task, fileName, size)` → `uploadId` + lệnh `curl` PUT dựng sẵn → `comment_task(task, uploadIds, content?)` (≤ 5, không base64).
- `get_task` / `list_task_comments`: `comments[].attachments` = `[{id, fileName, contentType, isImage, size}]` — **bỏ link presigned** (`ProjectTools.StripAttachmentUrls`).
- `view_attachment(id, source = task-comment)`: ảnh → image content JPEG ≤ 1280px; tệp khác → link 10 phút. Mặc định `source = chat`.
- Hồ sơ phiên `task` có `create_upload` + `view_attachment` (89 tool); `chat` / `meeting` vẫn không có `create_upload` — ở đó bot đưa ảnh bình luận việc vào chat / cuộc họp bằng `forwardAttachmentIds` (TEST-156, Projects trả tệp qua contract `ICommentFileLookup`, cùng quyền xem dự án; Chat chép sang khoá `chat/` riêng).

## Kiểm thử

`scripts/dev/task-comment-files-e2e.ts` (REST + MCP, 47/47) và `task-comment-files-ui-e2e.ts` (Chrome: dán ảnh, chip, gửi, ImageViewer — 13/13) — **chỉ DB + S3 tạm** ([../e2e.md](../e2e.md)).
