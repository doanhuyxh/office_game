# Xoá mềm bài ở `/social/facebook` (TEST-214)

> Nguồn sự thật là code: `SocialPostEndpoints.DeleteAsync` / `ListAsync` / `CountsAsync`, `SocialRules.CannotDeletePost` / `CanDeletePost` / `CanViewDeletedPosts` / `PostDeletedReason`, FE `features/social/components/facebook-post-card` + `facebook-posts-page`. Về [assets-social.md](assets-social.md).

## Phạm vi (chủ dự án chốt 23/11/2026)

- Bài đã đăng đã nằm trên Facebook; bản ghi OfficeHub chỉ còn là dấu vết ai đăng. Xoá = **gỡ khỏi danh sách OfficeHub**, không phải xoá trên Facebook.
- **Xoá mềm**: `social_posts.DeletedAt` / `DeletedByName` (migration `AssetsSocialPostSoftDelete`). Không xoá dòng, không xoá đích, **không xoá ảnh / video trên S3** (HR mở bài đã xoá vẫn xem đủ nội dung).
- **Không gọi Facebook**: bài trên Trang giữ nguyên; trang chi tiết Fanpage (`social_page_posts`) không đổi. Muốn xoá trên Facebook → menu ⋯ Xoá ở trang chi tiết Fanpage ([assets-social-page-post-moderation.md](assets-social-page-post-moderation.md)).
- **Không có khôi phục.** Không mở cho token AI (không đổi tool MCP).

## Quy tắc

| | |
|---|---|
| Bài xoá được | Không còn đích Chờ / Đang đăng — bài Đã đăng, Lỗi một phần, Lỗi, Đã huỷ. Còn đích chờ → 409 "bấm Huỷ phần chưa đăng trước"; đang đăng → 409 (`CannotDeletePost`) |
| Ai xoá | Người đăng + HR / Quản trị viên (`CanDeletePost`). Người giữ BM không phải tác giả → 403; người không xem được bài → 404 |
| Xoá lại | Bài đã xoá → 200, giữ người xoá / lúc xoá cũ |
| Ai xem bài đã xoá | Chỉ HR / Quản trị viên (`CanViewDeletedPosts`): danh sách `?deleted=true`, chi tiết, số đếm, link ảnh / video. Người khác: danh sách → 403, chi tiết + ảnh → 404 |
| Bài đã xoá chỉ đọc | Sửa / Huỷ / Đăng lại → 409 `PostDeletedReason` ("Bài đã bị xoá khỏi danh sách OfficeHub…"); DTO `canCancel` / `canEdit` / `canDelete` / `canRetry` = false |

Đua với job / đăng lại: xoá và đăng lại (`/targets/{id}/retry`) đều chạy trong transaction, khoá mọi đích của bài bằng `SELECT … FOR UPDATE` trước khi kiểm tra (như sửa bài TEST-208) → không bao giờ có bài đã xoá mà còn đích Chờ. Job nhận đích bằng `UPDATE` có điều kiện nên chờ khoá; sửa bài kiểm tra `DeletedAt` sau khi khoá.

## API (`/api/assets/social/facebook`)

| Method | Path | |
|---|---|---|
| DELETE | `/posts/{id}` | đánh dấu đã xoá, trả `SocialPostDto` |
| GET | `/posts?deleted=true` | chỉ bài đã xoá, mới xoá trước; HR / Quản trị viên, khác 403. Mặc định (không `deleted`) bỏ bài đã xoá |
| GET | `/posts/counts` | `{ deletedCount }` cho bộ lọc — HR / Quản trị viên, khác 403 |

DTO `SocialPostDto` thêm `canDelete`, `deletedAt`, `deletedByName`.

## Front-end

- `facebook-post-card`: nút **Xoá** (chỉ khi `canDelete`) → `confirmDialog` destructive "Chỉ gỡ bài khỏi danh sách OfficeHub, bài trên Facebook vẫn còn. Không khôi phục được.", nút `loading`. Bài đã xoá: viền đứt + nhãn "Đã xoá · bởi … lúc …", không nút thao tác.
- `facebook-posts-page`: HR / Quản trị viên có bộ lọc **Bài đăng / Đã xoá (N)** (cùng kiểu bộ lọc trang chi tiết Fanpage), chỉ hiện khi N > 0 hoặc đang xem "Đã xoá"; phân trang riêng theo bộ lọc.

## Test

`SocialRulesTests` (`CannotDeletePost_*`, `CanDeletePost_*`, `CanViewDeletedPosts_*`) · `social-e2e.ts` mục `[214]` (181/181 trên DB + S3 tạm 2026-11-23): xoá bài đã đăng → mất khỏi danh sách (người giữ + HR), HR thấy ở "Đã xoá" kèm người xoá / lúc xoá + nội dung + ảnh, số đếm; nhân viên `?deleted=true` / `/posts/counts` → 403; người giữ BM xoá bài HR → 403; người ngoài / id lạ → 404; còn đích chờ → 409, huỷ xong xoá được; xoá lại → 200; Sửa / Huỷ / Đăng lại bài đã xoá → 409; không lời gọi Graph nào, bài trên trang chi tiết Fanpage còn, tệp S3 còn.
