# Chia sẻ công khai trang sổ tay có thời hạn (TEST-228)

> Về [projects-wiki.md](projects-wiki.md) (sổ tay dự án, TEST-215) · mẫu token như [projects-comment-upload-links.md](projects-comment-upload-links.md) (TEST-175) · e2e [../e2e.md](../e2e.md)

Gửi một trang sổ tay (kèm trang con nếu muốn) cho **khách không có tài khoản** qua link công khai có hạn. Chủ dự án chốt 2026-11-25. Đợt này chỉ **back-end**;
giao diện web (nút chia sẻ ở tab Sổ tay, trang công khai `/w/{token}`) làm ở việc sau.

Back-end: `Domain/WikiShareRules.cs` (quy tắc thuần, test `WikiShareRulesTests`), `Features/WikiShareEndpoints.cs`, entity `WikiShareLink` / `WikiShareView` trong `Domain/Entities.cs`.

## Quy tắc (`WikiShareRules`)

- **Mỗi link một trang gốc**, `IncludeChildren` = kèm cả cây con. Link **luôn hiện bản mới nhất** (không đóng băng): trang con thêm sau tự hiện, trang xoá mềm (và cây con của nó) tự ẩn.
- **Tạo / xem danh sách / thu hồi**: quản lý dự án + HR / admin (`CanManage`), **chỉ trên web**. Token AI → 403 (ngoài allowlist `AccessTokenAuth`, endpoint cũng tự chặn);
  thành viên thường → 403; người không xem được dự án → 404. Dự án đóng: không tạo mới (409), vẫn xem / thu hồi được.
- **Hạn**: `days` 1 / 7 / 30 (mặc định 7) **hoặc** `expiresOn` (ngày, giờ văn phòng — hết hiệu lực lúc 0 giờ hôm sau), tối đa **90 ngày**; chọn cả hai / khác danh sách → 400.
  Không gia hạn: muốn kéo dài thì tạo link mới. ≤ 100 link còn hạn / dự án (409).
- **Token** như `UploadLinkRules`: 32 byte ngẫu nhiên base64url (43 ký tự), trả **một lần** lúc tạo; DB giữ SHA-256 hex (unique). Sai dạng / không có → **404**.
- **Hết hiệu lực → 410** "Link đã hết hạn hoặc bị thu hồi": hết hạn, thu hồi, trang gốc bị xoá, dự án đóng (mở lại dự án → link còn hạn dùng lại được).
- **Mật khẩu** tuỳ chọn 4–100 ký tự, lưu băm bằng `PasswordHasher<WikiShareLink>` (ASP.NET Identity, như mật khẩu tài khoản). `POST …/unlock` đúng → cookie riêng của link
  `oh_wshare_{linkId:N}` (HttpOnly, SameSite Lax, Secure khi https, path `/api/projects/public/wiki-shares`), giá trị = Id link mã hoá bằng DataProtection có hạn
  = min(24 giờ, hạn link). Sai → 400; sai ≥ 5 lần / 15 phút / (link, IP) hoặc ≥ 30 lần / 15 phút / link → **429** (đếm trong bộ nhớ Api — `WikiShareUnlockGuard`, khởi động lại thì đếm lại).
  Chưa mở khoá → `GET /{token}` trả `locked: true`, không có cây; `GET …/pages/{id}` → 401.
- **Nhật ký mở**: mỗi lần `GET /{token}` xem được nội dung (không cần mật khẩu hoặc đã mở khoá) → một dòng `wiki_share_views` (thời điểm, IP, User-Agent ≤ 300 ký tự) + `ViewCount` / `LastViewedAt`.
  Xem nhật ký: người tạo link, quản lý dự án, HR (không qua token AI).
- **Thông báo** người tạo link (chuông, không email — `NotificationCategories.WikiShareViewed`, catalog `projects.wiki_share_viewed`): lần mở đầu tiên, hoặc thiết bị mới
  (cặp IP + User-Agent chưa gặp với link này); tối đa **1 lần / giờ / link** (`LastNotifiedAt`). Link chuông → `/projects/{id}?tab=wiki&page={rootId}`.
- **Link Markdown giữa các trang** (`RewriteLinks`): url có `page={guid}` và `/projects/` hoặc `tab=wiki` → trang trong bản chia sẻ đổi thành `/w/{token}?page={id}`;
  trang ngoài (ngoài cây, dự án khác, đã xoá) đổi thành `wiki-share:not-shared` (FE hiện chữ thường, không lộ id nội bộ). Link khác giữ nguyên.

## Schema `projects` (migration `WikiShareLinks`)

- `wiki_share_links` (`[Audited]` — `TokenHash` / `PasswordHash` tự che trong lịch sử): `Id`, `ProjectId` (FK cascade → `projects`), `RootPageId` (FK restrict → `wiki_pages`),
  `IncludeChildren`, `Label` ≤ 200, `RecipientName` ≤ 200, `TokenHash` (64, unique `ux_wiki_share_links_token`), `PasswordHash?`, `ExpiresAt`, `RevokedAt` + `RevokedByName`,
  `CreatedAt` / `CreatedByUserId` (tài khoản nhận chuông) / `CreatedByName`, `ViewCount`, `LastViewedAt`, `LastNotifiedAt`. Index `ix_wiki_share_links_project_page` (ProjectId, RootPageId).
- `wiki_share_views`: `Id`, `LinkId` (FK cascade), `At`, `Ip` (64), `UserAgent` (300). Index `ix_wiki_share_views_link_at` (LinkId, At).

## API

| Route | Ai | Ghi chú |
|---|---|---|
| `POST /api/projects/{id}/wiki/shares` `{pageId, includeChildren?, days?, expiresOn?, label?, recipientName?, password?}` | quản lý dự án / HR, cookie | → `{id, token, expiresAt, share}` |
| `GET /api/projects/{id}/wiki/shares?pageId=` | quản lý dự án / HR | mới nhất trước, không token; `status` active / expired / revoked / gone, `hasPassword`, `viewCount`, `lastViewedAt` |
| `DELETE /api/projects/{id}/wiki/shares/{shareId}` | quản lý dự án / HR | thu hồi (204, lặp lại vẫn 204) |
| `GET /api/projects/{id}/wiki/shares/{shareId}/views?page=&pageSize=` | người tạo link, quản lý dự án, HR | `{items: [{at, ip, userAgent}], total, page, pageSize}` (≤ 100 / trang) |
| `GET /api/projects/public/wiki-shares/{token}` | ẩn danh | `{projectName, rootPageId, pages: [{id, parentId, title}], expiresAt, recipientName, requiresPassword, locked, notSharedHref}` — `parentId` của gốc = null |
| `POST …/public/wiki-shares/{token}/unlock` `{password}` | ẩn danh | 204 + cookie; sai 400; quá số lần 429 |
| `GET …/public/wiki-shares/{token}/pages/{pageId}` | ẩn danh | `{id, parentId, title, summary, content, updatedAt, path}` — content đã đổi link; trang ngoài bản chia sẻ 404 |

Nhóm công khai `AllowAnonymous` (không dùng cookie đăng nhập), rate-limit **60 request / phút / IP / đường dẫn** (policy `projects-wiki-share`, đăng ký ở `ProjectsModule`),
mọi phản hồi có `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store`. Không trả tên người sửa, id dự án hay trang ngoài bản chia sẻ.

## Kiểm thử

- `WikiShareRulesTests` (quyền, hạn + ngày tự chọn theo giờ VN + trần 90 ngày, mật khẩu, trạng thái 410, cookie ≤ 24 giờ, giới hạn nhập sai, chống báo lặp, cây chia sẻ, đổi link),
  `AccessTokenScopeTests` (4 route quản lý bị chặn với token AI), `NotificationCatalogTests` (hằng mới có trong catalog).
- E2E `scripts/dev/wiki-share-e2e.ts` — **chỉ DB tạm** (sửa hạn / lần báo bằng SQL qua `docker exec`), lệnh ở đầu file — 57/57 (2026-11-25).
