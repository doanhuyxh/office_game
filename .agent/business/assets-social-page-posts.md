# Chi tiết Fanpage + bài viết hiện có từ Facebook (TEST-206)

> Về [assets-social.md](assets-social.md) · [README.md](README.md). Nguồn sự thật là code: `Infrastructure/SocialService.cs` (`SyncPagePostsAsync`, `SocialTokenCheckJob`), `Infrastructure/FacebookGraph.cs` (`PagePostsAsync`), `Features/SocialPageEndpoints.cs`, `Domain/SocialRules.cs`; FE `features/social/components/facebook-page-detail`.

Chủ dự án chốt 2026-11-22: lấy **100 bài mới nhất** mỗi trang; đồng bộ khi **bấm nút** và **trong job kiểm tra token 5 giờ**; lưu **số tương tác** (cảm xúc, bình luận, chia sẻ) — chỉ số đếm, không lấy nội dung bình luận.

## Dữ liệu (migration `AssetsSocialPagePosts`)

| Bảng / cột | Ý nghĩa |
|---|---|
| `social_page_posts` | `PageId` (FK `social_pages`), `ExternalPostId` (duy nhất theo `(PageId, ExternalPostId)`), `Message` (text), `CreatedTime` (giờ đăng trên Facebook, UTC), `Permalink`, `PictureUrl` (link CDN Facebook — có thể hết hạn, **không** chép về S3), `StatusType`, `ReactionCount`, `CommentCount`, `ShareCount`, `SyncedAt`, `PostTargetId?` (FK `social_post_targets`, SetNull) |
| `social_pages` + `PostsSyncedAt`, `PostsSyncError` | Lần đồng bộ bài thành công gần nhất · lỗi lần gần nhất (null = lần gần nhất thành công) |

## Graph API

`GET /{page}/published_posts?fields=id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)&limit=…` bằng **page token qua header**; phân trang cursor `after` tới khi đủ 100 (không theo link `next` — chứa token). `shares` thiếu = 0. Quyền: `pages_read_engagement` + `pages_read_user_content` (đã thêm vào `RequiredPermissions` — token cũ thiếu quyền này hiện cảnh báo ở sheet BM; hướng dẫn tạo token đã ghi thêm).

## Đồng bộ (`SocialService.SyncPagePostsAsync`)

- Lấy 100 bài mới nhất → upsert: thêm bài mới, cập nhật nội dung + số tương tác bài cũ. **Không xoá** bài ngoài khoảng 100; chưa phát hiện bài bị xoá trên Facebook (để sau).
- Ẩn / hiện lại / xoá bài từ OfficeHub + bài đã xoá không hiện lại khi đồng bộ: [assets-social-page-post-moderation.md](assets-social-page-post-moderation.md) (TEST-211).
- `PostTargetId`: đích OfficeHub trên cùng trang có cùng `ExternalPostId` (bài chữ / ảnh; video có id riêng nên không khớp). Danh sách bài cũng tra lại lúc đọc → cờ "Đăng từ OfficeHub" + `postId`.
- Chỉ trang `IsActive` có page token. Thiếu quyền (10 / 200), lỗi Facebook khác, lỗi mạng → ghi `PostsSyncError`, không ném, BM không đổi. Lỗi token (190 / 102) → hàm chung `MarkTokenInvalidAsync` (BM "Token lỗi" + báo người giữ / HR / Quản trị viên — [assets-social-token-check.md](assets-social-token-check.md)).
- Đang đồng bộ trang đó (bấm / job) → bỏ qua (khoá trong RAM, giả định một instance Api).
- **Job 5 giờ** (`SocialTokenCheckJob`): BM kiểm tra token thành công → đồng bộ bài từng trang, mỗi trang một scope (lỗi một trang không chặn trang khác).

## API (`/api/assets/social/facebook/pages/{id}` — `SocialPageEndpoints`)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `` | `SocialPageDetailDto`: trang, trạng thái BM / token BM, người giữ, `postsSyncedAt`, `postsSyncError`, `postsSyncing`, `postCount`, `canSync` |
| GET | `/posts?page=&pageSize=` | Bài đã đồng bộ, mới nhất trước (`CreatedTime`), `fromOfficeHub` + `postId` |
| POST | `/sync-posts` | Đồng bộ ngay rồi trả chi tiết mới. Đang đồng bộ / vừa thành công < 1 phút (`PostsSyncCooldown`) → trả kết quả hiện có. Trang không còn trong BM / không có page token → 409 |

Quyền (`SocialRules.CanViewPage`, kiểm tra ở back-end): HR (mọi trang, kể cả BM ngừng dùng) + người **đang giữ** BM đang dùng; người khác → 404. Không mở cho token AI.

## Front-end

- `/social/facebook/pages/$pageId` (`PATHS.socialFacebookPage`, `FacebookPageDetailPage`): `PageToolbar` (← Facebook · nút **Đồng bộ bài viết** `loading`), phần đầu (ảnh, tên, danh mục, BM, người giữ, ID, "Đồng bộ bài lúc …", "Tự đồng bộ mỗi 5 giờ", mở Facebook, lỗi đồng bộ), danh sách `facebook-page-post-card` (ảnh — hỏng → ảnh thay thế, nội dung 3 dòng + Xem thêm, giờ VN, thích / bình luận / chia sẻ, nhãn "Đăng từ OfficeHub", Mở bài), phân trang, trạng thái rỗng. Đang đồng bộ → hỏi lại 3 giây.
- Lối vào: tên trang trong sheet BM (Tài sản → MXH, HR) và khối "Fanpage" (`facebook-page-list`) dưới ô soạn bài ở `/social/facebook` (HR / người giữ). Nút mở Facebook giữ nguyên.

## Test

`SocialRulesTests` (cooldown, `CanViewPage`, quyền mới) · `social-e2e.ts` (130 bài → lưu 100, 3 lượt cursor, nhãn OfficeHub, bấm dồn, #10 → lỗi, 190 → token lỗi + chuông, lần 2 thêm bài mới + giữ bài cũ + cập nhật số, quyền 404) · `social-token-check-e2e.ts` (job đồng bộ bài, trang thiếu quyền không chặn trang khác, số thích cập nhật lần sau).
