# Bình luận + trả lời bình luận của bài Fanpage (TEST-212)

> Về [assets-social-page-posts.md](assets-social-page-posts.md) · [assets-social-page-post-moderation.md](assets-social-page-post-moderation.md). Nguồn sự thật là code: `Infrastructure/SocialCommentService.cs`, `Infrastructure/FacebookGraph.cs` (`CommentsAsync`, `ReplyCommentAsync`), `Features/SocialPageEndpoints.cs` (`CommentsAsync`, `RepliesAsync`, `ReplyAsync`), `Domain/SocialRules.cs` (mục TEST-212); FE `features/social/components/facebook-post-comments`, `facebook-comment-item`, `facebook-comment-reply-box`.

Ở `/social/facebook/pages/$pageId`: xem bình luận của bài và **trả lời dưới tên Trang**. Ẩn / xoá bình luận **không** làm ở đợt này. Quyền: như xem trang (`SocialRules.CanViewPage`): HR (gồm Quản trị viên) xem mọi trang, người **đang giữ** BM xem trang của BM đang dùng. Người khác → 404.

## Dữ liệu (migration `AssetsSocialCommentReplies`)

**Không lưu bình luận** (bình luận đổi liên tục, cache dễ sai): mỗi lần mở / tải thêm đều gọi Facebook. Chỉ lưu **nhật ký trả lời** gửi từ OfficeHub, vì trên Facebook trả lời chỉ hiện tên Trang. Bảng `social_comment_replies`: `PagePostId` (FK `social_page_posts`, cascade), `FacebookCommentId` (bình luận được trả lời), `ReplyFacebookId` (id trả lời mới), `Message` ≤ 8000, `ByUserId`, `ByName`, `CreatedAt`. Trả lời trong danh sách có `ReplyFacebookId` khớp → DTO có `repliedByName` / `repliedAt`.

## Graph API (page token qua header Bearer)

| Việc | Lời gọi |
|---|---|
| Bình luận cấp 1 | `GET /{post-id}/comments?fields=id,message,from{id,name,picture},created_time,like_count,comment_count,attachment,can_reply_privately&filter=toplevel&order=reverse_chronological&limit=25[&after=]` |
| Trả lời của bình luận | `GET /{comment-id}/comments?fields=…&order=chronological&limit=25[&after=]` |
| Trả lời | `POST /{comment-id}/comments` form `message` → `{"id"}`. Chỉ chữ, không ảnh |

Phân trang bằng `paging.cursors.after`, chỉ khi có `paging.next` (không theo link `next` vì chứa token). Facebook có thể không trả `from` (quyền riêng tư / app chưa duyệt) → `fromName` null, FE hiện "Người dùng Facebook" + ảnh chữ "?". `fromPage` = `from.id` trùng id trang.

**Chưa thử trên trang thật** (agent không có token): cần kiểm tra Facebook có trả `from` với token System User + `pages_read_user_content` không, và ghi kết quả vào đây.

## API (`/api/assets/social/facebook/pages/{id}/posts/{postId}` — `SocialPageEndpoints`)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/comments?after=` | `SocialCommentListDto { items, after, canReply, replyBlockedReason }`, 25 / lần |
| GET | `/comments/{commentId}/replies?after=` | Trả lời, cũ nhất trước |
| POST | `/comments/{commentId}/replies` body `{ message }` | `SocialCommentReplyResultDto { reply, duplicate }` |

- `commentId` chỉ gồm chữ số và `_`, ≤ 100 ký tự (`IsCommentId`), khác → 404 (không gọi Facebook). Không kiểm tra bình luận có thuộc đúng bài không: page token chỉ chạm được nội dung của trang đó, người gọi đã có quyền với cả trang.
- Nội dung: bỏ khoảng trắng đầu / cuối, 1–8 000 ký tự (`ValidateReply`) → 400 theo field `message`.
- **Chặn gửi dồn**: cùng người + cùng bình luận + cùng nội dung trong 30 giây (`IsDuplicateReply`) → trả lại trả lời đã gửi, `duplicate = true`, không gọi Facebook. Khoá trong bộ nhớ theo (người, bình luận) để hai lần bấm cùng lúc đi lần lượt (giả định một instance Api).
- `canReply` / 409 khi trả lời (`CannotReply`): bài đã xoá, trang không còn trong BM, chưa có page token, token BM đang lỗi, danh sách quyền đã lưu không có `pages_manage_engagement` granted → "Token thiếu quyền pages_manage_engagement …". Chưa lấy được danh sách quyền → cứ gửi, Facebook báo lỗi nếu thiếu.

## Lỗi Facebook (`SocialCommentService.FailAsync`)

- HTTP 404 hoặc 100 + subcode 33: bình luận → 404 "Bình luận không còn trên Facebook"; bài → 404 "Bài viết không còn trên Facebook" + đánh dấu bài đã xoá (như TEST-211). Bài đã xoá trong OfficeHub → 404 luôn, không gọi Facebook.
- 190 / 102 → `MarkTokenInvalidAsync` (BM "Token lỗi" + báo người giữ / HR / Quản trị viên) + 409.
- Quyền (10, 200–299) → 409 "Token thiếu quyền pages_manage_engagement (…)" (`CommentError`); 100 khác → 400; còn lại → 409 "Facebook từ chối: …".
- Lỗi mạng / hết giờ → 502 "Không gọi được Facebook, thử lại".

## Front-end

- Thẻ bài (`facebook-page-post-card`): nút "N bình luận" mở / đóng khung bình luận ngay dưới thẻ (bài đã xoá: chỉ số, không mở).
- `facebook-post-comments`: `useInfiniteQuery` (key `['social-comments', …]` — không nằm dưới `facebookKeys.all` nên ẩn / đồng bộ bài không tải lại bình luận từ Facebook), khung xương khi tải, lỗi + Thử lại, "Bài chưa có bình luận nào.", "Xem thêm bình luận"; `canReply` false → hộp cảnh báo "Không trả lời được bình luận: <lý do>" và ẩn mọi nút Trả lời.
- `facebook-comment-item`: ảnh đại diện (lỗi → chữ viết tắt), tên / "Người dùng Facebook", nhãn "Trang", nội dung, ảnh đính kèm (bấm → `ImageViewer`), giờ VN, số thích, "Trả lời bởi <tên> lúc <giờ VN>"; "Xem N trả lời" tải trả lời (+ "Xem thêm trả lời"); nút **Trả lời** mở ô trả lời.
- `facebook-comment-reply-box`: `MessageInput` dùng chung (1 dòng tự giãn, Enter gửi, Shift+Enter xuống dòng, nút Gửi `loading`, tối đa 8 000). Gửi xong thêm trả lời vào cuối danh sách đã tải (bỏ qua nếu đã có — bấm trùng), tăng "Xem N trả lời" (trừ khi `duplicate`); lỗi → toast lý do, giữ chữ đã gõ.
- Số bình luận trên thẻ bài là tổng cấp 1 lúc đồng bộ (`comments.summary(total_count)`), không đổi khi trả lời.

## Test

`SocialRulesTests` (`ValidateReply`, `IsDuplicateReply`, `CannotReply`, `CommentError`, `IsCommentId`, `pages_manage_engagement` trong `RequiredPermissions`) · `social-e2e.ts` mục `[212]` (Graph giả thêm `/{id}/comments`: 25 + "Xem thêm", trường / thứ tự / header, không có `from`, ảnh đính kèm, trả lời cũ nhất trước, người ngoài / id lạ 404, nội dung rỗng / quá dài 400, trả lời + nhật ký + nhãn, bấm 2 lần song song chỉ 1 trả lời, bình luận / bài đã xoá 404, #200 → 409, thiếu `pages_manage_engagement` → `canReply` false + 409, 190 → token lỗi).
