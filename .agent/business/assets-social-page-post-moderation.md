# Ẩn / hiện lại / xoá bài của Fanpage (TEST-211)

> Về [assets-social-page-posts.md](assets-social-page-posts.md) · [assets-social.md](assets-social.md). Nguồn sự thật là code: `Infrastructure/SocialService.cs` (`ModeratePagePostAsync`), `Infrastructure/FacebookGraph.cs` (`SetPostHiddenAsync`, `DeletePostAsync`), `Features/SocialPageEndpoints.cs` (`ModerateAsync`), `Domain/SocialRules.cs`; FE `features/social/components/facebook-page-post-card`.

Chủ dự án chốt: **người giữ BM, HR và Quản trị viên** được **Ẩn / Hiện lại** và **Xoá** bài hiện có của trang ở `/social/facebook/pages/$pageId`.

## Dữ liệu (migration `AssetsSocialPagePostModeration`)

`social_page_posts` thêm: `IsHidden` (bool), `HiddenAt` / `HiddenByName` (lần ẩn từ OfficeHub; hiện lại → xoá; ẩn trên Facebook rồi đồng bộ về → null), `DeletedAt` / `DeletedByName` (đã xoá trên Facebook — **không xoá cứng dòng**; `DeletedByName` null = Facebook báo bài đã mất từ trước).

## Graph API (page token qua header như mọi lệnh khác)

| Việc | Lời gọi | Kết quả |
|---|---|---|
| Ẩn / hiện | `POST /{post-id}` form `is_hidden=true\|false` | `{"success":true}` (`false` → lỗi) |
| Xoá | `DELETE /{post-id}` | `{"success":true}` |
| Đồng bộ | `PostFields` thêm `is_hidden` | Có trường → cập nhật `IsHidden`; thiếu → giữ nguyên |

Tài liệu Meta không nói rõ quyền riêng cho ẩn / xoá (chỉ ghi "app chỉ sửa được bài do chính app đăng") và không nói `published_posts` có trả bài ẩn không → **chưa thử trên trang thật**; `RequiredPermissions` giữ nguyên. Lỗi quyền (10, 200–299) trả 409 kèm gợi ý kiểm tra `pages_manage_posts` / `pages_manage_engagement`. Thử thật xong mà thiếu quyền → thêm vào `RequiredPermissions` + [assets-social-permissions.md](assets-social-permissions.md).

## API (`/api/assets/social/facebook/pages/{id}` — `SocialPageEndpoints`)

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/posts/{postId}/hide` · `/posts/{postId}/unhide` | Trả `SocialPagePostDto` sau khi đổi |
| DELETE | `/posts/{postId}` | Đánh dấu `DeletedAt`; xoá lại bài đã xoá → 200, không gọi Facebook |
| GET | `/posts?deleted=true` | Chỉ bài đã xoá (mặc định bỏ bài đã xoá) |

- Quyền: `SocialRules.CanModeratePagePost` = `CanViewPage` (HR — `IsHr` gồm Quản trị viên — mọi trang; người **đang giữ** BM đang dùng). Người khác / bài không thuộc trang → 404.
- `CannotModeratePagePost` → 409: bài đã xoá (khi ẩn / hiện), trang không còn trong BM, chưa có page token.
- Lỗi Facebook: HTTP 404 hoặc mã 100 + subcode 33 (`IsPostGone`) → đánh dấu đã xoá (xoá → 200; ẩn / hiện → 409 "đã bị xoá trên Facebook"); 190 / 102 → `MarkTokenInvalidAsync` (BM "Token lỗi" + báo) + 409; lỗi khác → 409 "Facebook từ chối: …" (`ModerationError`); lỗi mạng → 409 "thử lại sau".
- DTO: `SocialPagePostDto` + `isHidden`, `hiddenAt`, `hiddenByName`, `deletedAt`, `deletedByName`, `canModerate`; `SocialPageDetailDto.postCount` chỉ đếm bài chưa xoá + `deletedCount`; `SocialTargetDto.deletedOnFacebookAt` (bài đăng từ OfficeHub đã bị xoá — qua `PostTargetId`, gắn lúc xoá nếu chưa có).

## Đồng bộ

Bài có `DeletedAt` bị bỏ qua khi upsert (Facebook trả trễ cũng không hiện lại). `is_hidden` khác giá trị đang lưu → cập nhật, xoá `HiddenAt` / `HiddenByName` (không biết ai ẩn trên Facebook).

## Front-end

- Thẻ bài (`facebook-page-post-card`): menu ⋯ (nút `loading` khi đang gửi) — "Ẩn khỏi trang" / "Hiện lại trên trang", "Xoá trên Facebook…" qua `confirmDialog` destructive ("Xoá vĩnh viễn trên Facebook, không khôi phục được"). Nhãn "Đã ẩn · bởi … lúc …" (ẩn trên Facebook: "Đã ẩn · trên Facebook"), viền đứt. Chỉ hiện menu khi `canModerate`.
- Trang chi tiết: có bài đã xoá → hai nút lọc "Bài trên trang (N)" / "Đã xoá (N)"; bài đã xoá có nhãn "Đã xoá · bởi … lúc …", không có menu.
- Thẻ bài OfficeHub (`facebook-post-card`): đích có `deletedOnFacebookAt` → nhãn "Đã xoá trên Facebook", ẩn link "Xem bài".

## Test

`SocialRulesTests` (`CanModeratePagePost`, `CannotModeratePagePost`, `IsPostGone`, `ModerationError`) · `social-e2e.ts` mục `[211]` (Graph giả: ẩn / hiện / xoá, header token, người ngoài 404, bộ lọc đã xoá + số đếm, bài đã mất 100/33, #200 → 409, bài gốc OfficeHub, đồng bộ lại không hiện bài đã xoá + giữ nhãn ẩn, 190 → token lỗi).
