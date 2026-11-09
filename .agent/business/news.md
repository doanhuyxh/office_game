# Bảng tin (module News)

> Nguồn sự thật là code: `backend/src/Modules/News/`, `frontend/src/features/news/`; nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Chủ dự án chốt 2026-11-07 (đừng hỏi lại): bảng tin **kiểu Facebook** — **ai cũng đăng được**, người đăng chọn phạm vi người xem; **có bình luận**; **gửi email là tuỳ chọn khi tạo bài**; **không có chuyên mục**; **mở cho AI đọc**; soạn bài bằng **trình soạn thảo rich-text**; có **video** và tệp, lưu S3 thư mục `feed/`; **@nhắc tên làm luôn**.

## Phạm vi người xem (`Audience`)

| Giá trị | Ai xem được |
|---|---|
| `Company` | Mọi tài khoản |
| `Departments` | Người thuộc phòng đích **hoặc phòng con** của nó (`NewsRules.DepartmentChain` đi ngược lên cha; bài cho phòng con thì phòng cha **không** thấy) |
| `Custom` | Đúng những tài khoản được chọn |
| `Private` | Chỉ tác giả |

- Tác giả **luôn** thấy bài mình. Phạm vi tính **lúc đọc** (chuyển phòng ban → thấy bài phòng mới, mất bài phòng cũ).
- Mọi đường đọc (feed, chi tiết, bình luận, cảm xúc, link tệp, MCP) lọc qua `NewsStore.Visible` / `FindVisibleAsync` → ngoài phạm vi là **404** (không lộ có bài). Admin / HR **không** có đường đọc bài `Private` / `Custom` của người khác (giống tin 1-1 ở [chat.md](chat.md)).
- Bài **bị ẩn** (kiểm duyệt): chỉ tác giả + HR thấy; tác giả không sửa được (409), người khác bình luận → 404.

## Schema `news` (migration `InitialNews`)

| Bảng | Nội dung |
|---|---|
| `posts` | `Seq` (identity = con trỏ feed), `AuthorUserId` + `AuthorName` (snapshot), `ContentHtml` (đã lọc) + `PlainText`, `Audience`, `CommentsDisabled`, `SendEmail`, `PinnedUntil`, `HiddenAt` + `HiddenReason` + `HiddenByUserId`, `EditedAt`, `DeletedAt`, `ReactionCount` / `CommentCount` (bản sao để feed không phải đếm) |
| `post_targets` | `(PostId, Kind, TargetId)` — `Department` = id phòng ban, `User` = id tài khoản |
| `post_media` | `Kind` (Image / Video / File), `FileKey`, `FileName`, `ContentType`, `Size`, `Order` |
| `comments` | `Seq`, `PostId`, `ParentId` (**một cấp**: trả lời của trả lời gom về gốc), `Text` ≤ 2000, `ImageKey/Name/ContentType`, `EditedAt`, `HiddenAt` + lý do, `DeletedAt`, `ReactionCount` |
| `reactions` | `(TargetType, TargetId, UserId)` → `Type` (Like / Love / Haha / Wow / Sad / Angry) — mỗi người **một** cảm xúc / mục |
| `mentions`, `feed_states`, `upload_tickets` | người được @nhắc (không mở rộng quyền xem) · `LastSeenSeq` cho badge · vé tải lên chưa gắn bài (dọn sau 24 giờ) |

Xoá bài / bình luận là **xoá mềm**; bình luận gốc đã xoá mà còn trả lời thì giữ chỗ "đã bị xoá".

## Nội dung & an toàn

- FE gửi HTML, BE **lọc bằng `HtmlCleaner`** (NuGet `HtmlSanitizer`) trước khi lưu: chỉ `p br strong b em i u s h2 h3 ul ol li blockquote a span code pre hr`, thuộc tính `href target rel data-mention`, scheme `http(s) mailto tel`; link luôn `target=_blank` + `rel=noopener noreferrer nofollow`; `data-mention` chỉ nhận Guid. Không ảnh / style / script trong thân bài. Test XSS: `OfficeHub.Modules.News.Tests`.
- `PlainText` (`NewsRules.ToPlainText`) dùng cho email, MCP, xem trước. Giới hạn **20.000** ký tự chữ thuần.
- **@nhắc**: trong bài là `<span data-mention="<userId>">`, trong bình luận là `@[Tên](<userId>)` (`NewsRules.ExtractMentions`). Chỉ báo cho người **xem được bài** (`FilterVisibleAsync`).

## Tệp (S3 `feed/`)

`POST /uploads` → vé + presigned PUT 60 phút → trình duyệt PUT thẳng S3 (cần CORS — [env.md](../env.md#s3-cors-kho-tài-liệu)) → đăng bài kèm `uploadIds`, Api `HEAD` kiểm tra đã lên + dung lượng. Khoá `feed/{yyyy}/{MM}/{vé}/{tên-an-toàn}` (dưới `files/`), **không** chung `documents/` / `chat/`. Ảnh (jpeg/png/webp/gif) ≤ **10 MB**, video (mp4/webm/quicktime) ≤ **200 MB**, tệp khác ≤ **25 MB**; tối đa **10 tệp/bài**; chặn đuôi chạy chương trình + `.html` / `.svg`. Bình luận: **1 ảnh**. Link trả về là presigned GET 60 phút (`GET /media/{id}/url` lấy link mới).

## Email + thông báo

| Khi | Ai nhận | Kênh | `Category` |
|---|---|---|---|
| Đăng bài có ☑ "Gửi email" | mọi người trong phạm vi (trừ tác giả) | email + app | `news_published` |
| Bình luận / trả lời | chủ bài · người được trả lời | chỉ app | `news_comment` |
| Được @nhắc (bài / bình luận) | người được nhắc, nếu xem được bài | chỉ app | `news_mention` |
| HR ẩn / gỡ bài hoặc bình luận | tác giả (kèm lý do) | chỉ app | `news_moderated` |

- Email **chỉ gửi một lần lúc đăng**, sửa bài sau đó không gửi lại; `Private` + email → 400. Bài **không** chọn email thì không tạo chuông (chỉ badge "bài mới").
- **Hạn mức chống spam**: mỗi người **3 bài có email / ngày** (theo ngày giờ VN, `NewsRules.StartOfDay`) → quá thì **429**; admin / HR không giới hạn. Giới hạn tốc độ: 1 bài / 5 giây, 1 bình luận / giây (`NewsThrottle`).
- Cảm xúc **không** tạo thông báo (tránh ồn).

## API (`/api/news`, đăng nhập)

| Method | Path | Kết quả |
|---|---|---|
| GET | `/feed?cursor=&take=&authorId=&mine=` | `{ pinned (chỉ trang đầu), items, nextCursor }` — con trỏ `Seq` giảm dần, take 1–30 |
| GET | `/posts/{id}` · POST `/posts` · PUT `/posts/{id}` · DELETE `/posts/{id}` | chi tiết · đăng · sửa (không đổi được `SendEmail`; `removeMediaIds` gỡ tệp) · xoá mềm (tác giả hoặc HR) |
| PUT / DELETE | `/posts/{id}/reaction` · `/comments/{id}/reaction` | thả / gỡ cảm xúc → `{ total, counts, mine }` |
| GET | `/posts/{id}/reactions` · `/comments/{id}/reactions` | ≤ 100 người đã thả (tên + loại) |
| GET | `/posts/{id}/comments?after=&take=` | bình luận gốc (tăng dần `Seq`) + mọi trả lời của chúng, `hasMore` |
| POST | `/posts/{id}/comments` · PUT / DELETE `/comments/{id}` | bình luận (`text`, `parentId`, `uploadId`) · sửa (chính chủ) · xoá (chính chủ / chủ bài / HR) |
| POST | `/uploads` · GET `/media/{id}/url?download=` | vé + presigned PUT · link mới |
| GET | `/people?search=` · `/departments` | ≤ 20 người (tìm không dấu) · phòng ban (kèm `parentId`) |
| GET | `/unseen-count` · POST `/seen` | số bài mới của người khác · đánh dấu đã xem (lần đầu tự coi như đã xem hết) |
| POST | `/admin/posts/{id}/hide|unhide|pin|unpin`, `/admin/comments/{id}/hide|unhide` | **`AuthPolicies.Hr`**; ẩn **bắt buộc lý do**; ghim 1–90 ngày (mặc định 7) chỉ cho bài `Company` đang hiện |

## Front-end (`features/news/`)

- **`/news`** (menu Chung → "Bảng tin", badge bài mới): cột giữa `max-w-2xl`, ô "Bạn muốn chia sẻ điều gì?", tab Tất cả / Bài của tôi, bài ghim trên đầu, cuộn vô hạn (IntersectionObserver). Vào trang = `POST /seen`.
- **`/news/{id}`** (`?comment=<id>` cuộn tới bình luận) cho link từ email / chuông; `linkTarget` (`features/notifications/utils/labels.ts`) tách query cho `navigate`.
- Hộp soạn bài: **Tiptap** (`@tiptap/react` + `starter-kit` + `extension-placeholder`), **lazy load** → chunk `post-editor` riêng (~400 KB không vào gói chính); thanh công cụ đậm / nghiêng / gạch chân / H2 / danh sách / trích dẫn / link / emoji / @nhắc + `AudiencePicker` + đính kèm (tiến độ tải S3) + ☑ email + ☑ tắt bình luận.
- `PostCard`: thu gọn bài dài, lưới ảnh / video kiểu FB + xem ảnh lớn, hover ra 6 emoji, bình luận một cấp; menu sửa / xoá / ghim / ẩn theo cờ `canEdit` / `canDelete` / `canHide` **do BE trả** (không suy từ vai trò).
- `RecentNews`: thẻ "Bảng tin" ở `/` (gọn, 2 dòng) và tab **Tin tức** của 📌 Bảng tin trong 3D (`full`: nội dung đầy đủ + ảnh/tệp, không rút gọn; bấm tên tác giả mở bài ở tab mới để giữ phiên 3D) — [office-documents.md](office-documents.md).

## MCP

- **Đọc** (ai cũng được): `list_news_feed`, `get_news_post` ([mcp.md](mcp.md)). Token AI được `GET /api/news/feed` và `GET /api/news/posts/*` (`AccessTokenAuth`); endpoint tự trả `contentHtml = null` + media / ảnh bình luận **không có url** khi gọi bằng token AI (`ClaimsPrincipal.IsAccessToken()`).
- **Đăng bài — chỉ admin / HR** (thêm 2026-11-09): `create_news_post`. Token được `POST /api/news/posts` (khớp đúng path), nhưng `CreateAsync` trả **403** nếu gọi bằng token mà không phải `IsHr()` (nhân viên vẫn đăng trên web), và **400** nếu có `uploadIds` (AI không tải tệp được). Tool đổi Markdown đơn giản → HTML (`NewsTools.MarkdownToHtml`, test `NewsMarkdownTests`), Api vẫn lọc bằng `HtmlCleaner`; phạm vi `Company` / `Departments` (phòng ban nhận id / tên / mã); email + hạn mức như trên web (admin / HR không giới hạn).
- Sửa / xoá bài, bình luận, cảm xúc, tải tệp, ẩn / ghim **chỉ trên web**.

## Test

`dotnet test` (`OfficeHub.Modules.News.Tests`: phạm vi, chuỗi phòng ban, lọc XSS, @nhắc, giới hạn tệp, mốc ngày VN); e2e trên DB tạm `news-e2e.ts` — [e2e.md](../e2e.md).

## Chưa làm

Tìm kiếm toàn văn, sửa / xoá cảm xúc hàng loạt, thống kê "ai đã đọc", chia sẻ lại bài, bài hẹn giờ, dọn tệp S3 mồ côi, realtime (bài mới hiện ngay không cần tải lại), video xem trước dạng stream (hiện phát trực tiếp từ presigned URL).
