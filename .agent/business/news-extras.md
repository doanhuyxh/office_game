# Bảng tin: hẹn giờ, ai đã xem, chia sẻ lại, bài mới tự hiện (TEST-54)

> Phần mở rộng của [news.md](news.md) (phạm vi, schema gốc, API). Code: `backend/src/Modules/News/` (`PostEndpoints` — CreateAsync / EditAsync / ViewsAsync / ViewersAsync, `Infrastructure/NewsScheduler.cs`), `frontend/src/features/news/`.

Chủ dự án chốt 2026-11-12: thống kê "ai đã xem" chỉ **người đăng + HR** xem được. Giới hạn tự đặt (chưa chủ dự án xác nhận): hẹn giờ 1 phút – 60 ngày.

## Bài hẹn giờ (`posts.PublishAt`)

- `POST /posts` thêm `publishAt` (ISO có múi giờ; FE nhập ngày + giờ VN → `vnInstant`). Sai khoảng → 400 `publishAt`. Token AI không hẹn giờ được (400).
- Chưa tới giờ: **chỉ tác giả thấy** (`NewsStore.Visible` lọc `PublishAt == null || tác giả`) — admin / HR / người khác 404, không ghim được; FE hiện viền đứt + "Hẹn đăng lúc …". Email / chuông @nhắc **chưa gửi**.
- Job `NewsScheduler` (`news.scheduler`, 30 giây, trang Vận hành) đăng bài tới giờ: `UPDATE … SET "Seq" = DEFAULT` (identity ALWAYS → số mới ⇒ bài nổi lên đầu feed và tính "bài mới"), `CreatedAt` = lúc đăng, `PublishAt` = null, rồi gửi email (nếu chọn) + @nhắc như đăng ngay (`PostEndpoints.NotifyNewPostAsync`). Điều kiện `PublishAt IS NOT NULL` chặn đăng hai lần. Giả định một instance Api.
- `PUT /posts/{id}` với bài đang hẹn: `publishAt` = đổi giờ (không tính "đã sửa"), `publishNow: true` = đăng ngay (FE: bỏ tick "Hẹn giờ đăng"). Bài đã đăng bỏ qua hai trường này. Hạn mức 3 bài email / ngày tính theo ngày **tạo** bài.

## Ai đã xem (`news.post_views`)

- `(PostId, UserId)` khoá chính + `ViewedAt` = lần đầu thấy. FE (`PostCard`) báo khi bài của người khác hiện ≥ 50 % màn hình trong 1 giây; `trackPostView` gom, gửi `POST /posts/views {postIds ≤ 50}` mỗi 3 giây, mỗi bài một lần / phiên trang. Server chỉ ghi bài người đó **xem được**, đã đăng, không phải của mình (`INSERT … ON CONFLICT DO NOTHING`); id lạ bị bỏ qua (204, không lộ bài).
- `PostDto.viewCount` chỉ có với tác giả / HR (người khác `null`). `GET /posts/{id}/viewers` → `{count, audienceCount, items[{userId, name, code, departmentName, viewedAt}]}` (≤ 500 dòng, mới nhất trước) — tác giả / HR; người khác 404; **token AI 403** (danh sách người đọc không ra trợ lý AI). `audienceCount` = số người trong phạm vi (trừ tác giả) → FE "x / y đã xem".

## Chia sẻ lại (`posts.SharedPostId`)

- `POST /posts` thêm `sharedPostId`: bài gốc phải xem được, đã đăng, không bị ẩn (khác → 404); chia sẻ bài chia sẻ → trỏ **bài gốc** (không chuỗi). Nội dung được để trống. Token AI không chia sẻ được.
- Bài chia sẻ có phạm vi riêng, nhưng **không mở rộng phạm vi bài gốc**: `PostDto.sharedPost` chỉ có khi người xem tự xem được bài gốc (`ToDtosAsync` lọc qua `Visible`); không thì `sharedPost = null` → FE "Bài viết gốc không còn hoặc bạn không có quyền xem". Bài gốc bị xoá / ẩn → tương tự.
- Không thông báo cho tác giả bài gốc, không đếm số lượt chia sẻ.

## Bài mới tự hiện

Không có kênh đẩy Api → trình duyệt cho bảng tin; đang mở `/news` (tab Tất cả) thì `useNewsUnseenLive` hỏi `/unseen-count` **mỗi 20 giây** → nút "N bài mới" (bấm = tải lại feed + đánh dấu đã xem). Ngoài trang vẫn là badge 60 giây như cũ.

## Dọn tệp mồ côi (cả Chat)

- Vé tải lên quá 24 giờ chưa gắn bài / tin: lần xin vé kế tiếp xoá **file S3** (key chính + key tạm `uploads/`) rồi mới xoá dòng vé — `BuildingBlocks/Storage/UploadCleanup.PurgeAsync` (≤ 20 vé / lần; S3 lỗi → giữ vé cho lần sau). Trước đây chỉ xoá dòng vé, file nằm lại.
- Sửa bài gỡ tệp (`removeMediaIds`) → xoá file đó trên S3 sau khi lưu. Bài / tin bị xoá mềm / thu hồi **vẫn giữ file** (quy tắc cũ).

## Test

`OfficeHub.Modules.News.Tests/NewsScheduleShareTests.cs`; e2e `scripts/dev/news-extra-e2e.ts` (33 kiểm tra, ~2 phút) — [e2e.md](../e2e.md).
