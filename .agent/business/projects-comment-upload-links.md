# Link tải tệp từ thiết bị khác cho bình luận việc (TEST-175)

> Về [projects-comment-files.md](projects-comment-files.md) (tệp đính kèm bình luận, TEST-153) · e2e [../e2e.md](../e2e.md)

Người đang đăng nhập tạo link → mở trên điện thoại / máy khác **không cần đăng nhập** → chọn / kéo-thả tệp → tải thẳng S3 → thành **bình luận đứng tên người tạo link**, nhãn "Qua link tải lên". Chủ dự án chốt 2026-11-18.

## Quy tắc (`Domain/UploadLinkRules.cs`, test `UploadLinkRulesTests`)

- Tạo: **thành viên** dự án đang chạy (không tính HR / quản trị không phải thành viên), **chỉ trên web** (token AI → 403), người ngoài → 404. Hạn chọn **15 phút / 1 giờ / 24 giờ** (mặc định 1 giờ; khác → 400). ≤ 10 link còn hạn / người / việc (409).
- Token 32 byte ngẫu nhiên (base64url, 43 ký tự) chỉ trả **một lần** lúc tạo; DB giữ **SHA-256 hex** (`TokenHash`, unique). Sai dạng / không có → 404.
- Link hết hiệu lực (**410** "Link đã hết hạn hoặc bị thu hồi") khi: hết hạn, thu hồi, dự án đóng, người tạo không còn là thành viên / nghỉ việc. Việc bị xoá → link xoá theo (FK cascade) → 404.
- Tệp theo y nguyên `CommentFileRules` (ảnh ≤ 10 MB, tệp ≤ 25 MB, chặn đuôi chạy, ≤ 5 tệp / lần, kiểm chữ ký đầu file khi promote). Thêm: **≤ 50 tệp / link** (đã gửi + vé đang treo 30 phút) → 429. Qua link **bắt buộc có tệp** (ghi chú tuỳ chọn).
- Vé xin qua link mang `UploadLinkId` — chỉ gửi được qua đúng link đó; vé web không gửi được qua link và ngược lại. Vé bỏ dở dọn như cũ (`UploadCleanup`, 24 giờ).
- Bình luận: `AuthorEmployeeId` / tên = người tạo link, `ByBot = false`, lưu `UploadLinkId` + `ClientIp` + `UserAgent` (≤ 300, tra soát, **không trả ra API**). Chuông / @nhắc / luồng thay đổi như bình luận thường (không thêm loại thông báo). Người tạo xoá được bình luận như bình luận của mình.

## Schema `projects` (migration `TaskCommentUploadLinks`)

- `comment_upload_links`: `Id`, `TaskId` (FK cascade → `tasks`), `UserId`, `TokenHash` (64, unique `ux_comment_upload_links_token`), `ExpiresAt`, `RevokedAt`, `CreatedAt`, `FileCount`; index (`TaskId`, `UserId`).
- `task_comments` + `UploadLinkId` (uuid null), `ClientIp` (64), `UserAgent` (300). `comment_upload_tickets` + `UploadLinkId` (index `ix_comment_upload_tickets_link`).

## API (`Features/UploadLinkEndpoints.cs`)

| Route | Ai | Ghi chú |
|---|---|---|
| `POST /api/projects/tasks/{tid}/upload-links` `{minutes?}` | thành viên, cookie | → `{id, token, expiresAt}` |
| `GET /api/projects/tasks/{tid}/upload-links` | người xem được dự án | link còn hạn **của tôi** `{id, createdAt, expiresAt, fileCount}` (không token) |
| `DELETE /api/projects/upload-links/{id}` | chỉ người tạo (khác → 404) | thu hồi (204) |
| `GET /api/projects/public/upload-links/{token}` | ẩn danh | `{taskCode, expiresAt, fileCount, maxFiles, maxFilesPerComment}` — không tên việc / id |
| `POST …/public/upload-links/{token}/uploads` `{fileName, size}` | ẩn danh | vé presigned PUT như `POST /tasks/{tid}/uploads` |
| `POST …/public/upload-links/{token}/comments` `{content?, uploadIds}` | ẩn danh | → `{fileCount}` (không id bình luận) |

Nhóm `/public/upload-links` `AllowAnonymous`, bỏ qua cookie, rate-limit **60 request / phút / IP / đường dẫn** (policy `projects-upload-link`, đăng ký ở `ProjectsModule`). Lõi đăng bình luận dùng chung `TaskEndpoints.PostCommentAsync` (web / AI / link). `CommentDto.viaUploadLink` cho web.

## Web

- `features/projects/components/upload-link-dialog`: nút điện thoại cạnh kẹp giấy trong ô bình luận (`task-comment-input`, `onUploadLink`) → chọn hạn → **Tạo link** → mã QR (`qrcode.react`) + URL `/u/{token}` + sao chép + **Thu hồi** (hộp xác nhận); dưới là các link còn hạn khác của tôi (hạn, số tệp, thu hồi).
- `features/upload-link` (route công khai `/u/$token`, `PATHS.uploadLink`, ngoài `protectedRoute`, chunk riêng ~10 KB): logo + nút sáng / tối, mã việc + đếm ngược + `n/50 tệp`, vùng chọn tệp + kéo-thả cả trang, chip xem trước, ghi chú, **Gửi** (`loading`), danh sách "Đã gửi" trong phiên, QR của chính link. 404 → "Link không tồn tại", 410 / đếm ngược về 0 → "Link đã hết hạn hoặc bị thu hồi". Dùng lại `fileProblem` / `putToS3` qua barrel `@/features/projects`.
- Bình luận qua link: nhãn **"Qua link tải lên"** (biểu tượng điện thoại) cạnh tên trong `task-dialog`.

## Kiểm thử

`scripts/dev/task-upload-link-e2e.ts` (REST + Chrome điện thoại 390×844 sáng / tối + web) — **chỉ DB + S3 tạm**.
