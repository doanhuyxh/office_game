# Sửa bài Facebook đã hẹn giờ (TEST-208)

> Về [assets-social.md](assets-social.md) · [README.md](README.md). Nguồn sự thật là code: `Features/SocialPostEndpoints.cs` (`UpdateAsync`), `Domain/SocialRules.cs` (`CannotEditPost`, `CanEditAuthor`), `Infrastructure/SocialService.cs` (`PublishTargetAsync`); FE `features/social/components/facebook-post-composer` (chế độ sửa) + `facebook-post-edit-dialog`.

Mục "sửa bài đã hẹn" của TEST-55. Trước đây bài đã hẹn không sửa được (phải huỷ rồi soạn lại).

## Bài nào sửa được (`SocialRules.CannotEditPost`, có test)

- **Chưa đích nào từng được gửi đi**: mọi đích đang Chờ với `Attempts = 0` hoặc Đã huỷ, và còn ít nhất một đích Chờ.
- Có đích Đang đăng / Đã đăng / Lỗi, đích Chờ có `Attempts > 0` (đang chờ thử lại), hoặc không còn đích Chờ → **409** kèm lý do.
- DTO bài có `canEdit` (= quyền sửa + điều kiện trên), `editedAt`, `editedByName`.

## Ai sửa được

- **Người đăng bài + HR / admin** (`SocialRules.CanEditAuthor`). Kiểm tra ở back-end.
- Người giữ BM không phải tác giả: vẫn chỉ **huỷ** được (sửa → 403). Đây là mặc định người soạn việc đặt, **chủ dự án chưa xác nhận**.
- Người không xem được bài → 404. Người sửa phải còn quyền đăng lên **mọi trang đích sau khi sửa** (như lúc tạo: trang thuộc BM mình được đăng, còn trong BM, có page token) → 400.

## Sửa được gì — `PUT /api/assets/social/facebook/posts/{id}`

Body như tạo bài (`SocialPostRequest`: `message`, `link`, `pageIds`, `mediaIds` theo thứ tự, `scheduledAt` — null = đăng ngay). Trả bài sau khi sửa. Không mở cho token AI.

- Kiểm tra bằng `SocialRules.ValidatePost` như lúc tạo (giờ hẹn mới ≥ hiện tại + 2 phút, ≤ 180 ngày, ≤ 10 ảnh hoặc 1 video, link không kèm ảnh…).
- **Tệp mới**: do chính người sửa tải lên, đã xác nhận, chưa gắn bài nào. Tệp đang thuộc bài giữ lại được (kể cả HR sửa bài người khác). Đổi thứ tự = thứ tự `mediaIds`.
- **Tệp bị bỏ**: xoá dòng `social_media` trong transaction; xoá tệp trên S3 **sau khi commit** (lỗi S3 bỏ qua — chỉ thành tệp mồ côi).
- **Trang bị bỏ**: xoá dòng đích Chờ (chưa từng chạy). **Trang thêm**: tạo đích Chờ mới; trang từng bị huỷ trong bài này được chọn lại → đích đó về Chờ (xoá thông tin huỷ, `Attempts = 0`).
- Mọi đích Chờ nhận `DueAt` = giờ hẹn mới (hoặc lúc sửa nếu đăng ngay). Đăng ngay → `SocialPublishSignal.Poke()`.
- Dấu vết: `social_posts.EditedAt`, `EditedByName` (migration `AssetsSocialPostEdits`). Thẻ bài hiện "Đã sửa lúc … bởi …".

## Không đua với job đăng

- Endpoint chạy trong **một transaction**: `SELECT … FROM assets.social_post_targets WHERE "PostId" = … FOR UPDATE` khoá mọi đích của bài **trước** khi kiểm tra quyền / trạng thái, rồi mới đọc trang / tệp và ghi.
- Job nhận đích bằng `UPDATE … WHERE Status = Pending AND DueAt <= now` (`PublishTargetAsync`):
  - Job nhận trước → đích đã Đang đăng → sửa bị **409** "Bài đang được đăng, không sửa được nữa".
  - Sửa giữ khoá trước → UPDATE của job chờ commit rồi Postgres đánh giá lại điều kiện trên dòng mới: dời giờ → không nhận; trang bị bỏ (dòng xoá) → không nhận; còn đến hạn → nhận và đọc **nội dung + ảnh mới** (đã commit).
  - Sau khi nhận, đích ở Đang đăng nên không lần sửa nào lọt vào giữa lúc job đọc nội dung → không có chuyện đăng nội dung cũ sau khi API báo sửa thành công, hay nửa cũ nửa mới.
- Điều kiện `DueAt <= now` mới thêm ở bước nhận đích: trước đó job lấy danh sách đến hạn rồi nhận theo `Id + Pending`, nên bài vừa dời giờ vẫn có thể bị đăng theo giờ cũ.

## Front-end

- `facebook-post-card`: nút **Sửa** khi `canEdit` → `facebook-post-edit-dialog` (hộp thoại, cuộn được trên điện thoại).
- `facebook-post-composer` có prop `post` = chế độ sửa: điền sẵn trang đang Chờ, nội dung, link, ảnh / video (ảnh có sẵn xem qua link S3 có hạn; nút ‹ › đổi thứ tự, × bỏ), giờ hẹn (giờ VN); bỏ chọn "Hẹn giờ" = "Lưu và đăng ngay". Trang đang chờ mà người sửa không còn thấy hiện ở nhóm "Không còn quyền đăng" để bỏ chọn. Id ô nhập có tiền tố riêng (không trùng khung soạn bên trái).
- Lưu dùng `Button loading`. Lỗi 409 / 403 / 404 → toast lý do, làm mới danh sách, đóng hộp thoại; lỗi kiểm tra (400) hiện dưới từng ô.

## Test

`SocialRulesTests` (thêm `CannotEditPost_*`, `CanEditAuthor_*`). `scripts/dev/social-e2e.ts` mục `[208]` (mất thêm ~4 phút vì chờ giờ hẹn thật): sửa nội dung + giờ → giờ cũ không đăng, giờ mới đăng nội dung mới; bỏ / thêm / đổi thứ tự ảnh (Graph nhận đúng bộ mới, tệp bỏ không còn trên S3); bỏ / thêm trang; đăng ngay; đã đăng / đã huỷ / chờ thử lại → 409; người ngoài 404; người giữ BM sửa bài HR 403; 6 vòng × 3 lần sửa song song với job → luôn đăng đúng một lần, đúng bản cuối đã lưu.
