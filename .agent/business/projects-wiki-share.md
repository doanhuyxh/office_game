# Chia sẻ công khai sổ tay có thời hạn (TEST-228, phạm vi TEST-230)

> Về [projects-wiki.md](projects-wiki.md) (sổ tay dự án, TEST-215) · mẫu token như [projects-comment-upload-links.md](projects-comment-upload-links.md) (TEST-175) · e2e [../e2e.md](../e2e.md)

Gửi sổ tay cho **khách không có tài khoản** qua link công khai có hạn — **toàn bộ sổ tay** hoặc **các trang được chọn** (TEST-230). Chủ dự án chốt 2026-11-25. Back-end TEST-228,
giao diện web TEST-229 (mục "Giao diện" cuối file). Đường dẫn công khai **`/s/{token}`** (theo TEST-229; TEST-228 lúc đầu đặt `/w/`, đã đổi cả `RewriteLinks`).

Back-end: `Domain/WikiShareRules.cs` (quy tắc thuần, test `WikiShareRulesTests`), `Features/WikiShareEndpoints.cs`, entity `WikiShareLink` / `WikiSharePage` / `WikiShareView` trong `Domain/Entities.cs`.

## Quy tắc (`WikiShareRules`)

- **Phạm vi** (`Scope`, TEST-230): `all` = mọi trang chưa xoá của dự án, kể cả trang tạo sau; `pages` = danh sách trang được chọn (1–200, không trùng, cùng dự án, chưa xoá),
  mỗi trang có `IncludeChildren` = kèm cả cây con, **gồm trang con tạo sau**. Link **luôn hiện bản mới nhất** (không đóng băng); trang xoá mềm (và cây con của nó) tự ẩn.
- **Cây công khai** (`SharedPages`): tập trang = trang chọn + cây con của trang `IncludeChildren`; thứ tự `Position` rồi tên như sổ tay. Trang chọn mà trang cha không có trong bản chia sẻ
  → nối vào **tổ tiên gần nhất** có trong bản chia sẻ, không có thì đứng ở gốc (`parentId` null). Không lộ trang ngoài phạm vi (cả trong `path`).
- **Tạo / xem danh sách / thu hồi**: quản lý dự án + HR / admin (`CanManage`), **chỉ trên web**. Token AI → 403 (ngoài allowlist `AccessTokenAuth`, endpoint cũng tự chặn);
  thành viên thường → 403; người không xem được dự án → 404. Dự án đóng: không tạo mới (409), vẫn xem / thu hồi được.
- **Hạn**: `days` 1 / 7 / 30 (mặc định 7) **hoặc** `expiresOn` (ngày, giờ văn phòng — hết hiệu lực lúc 0 giờ hôm sau), tối đa **90 ngày**; chọn cả hai / khác danh sách → 400.
  Không gia hạn: muốn kéo dài thì tạo link mới. ≤ 100 link còn hạn / dự án (409).
- **Token** như `UploadLinkRules`: 32 byte ngẫu nhiên base64url (43 ký tự), trả **một lần** lúc tạo; DB giữ SHA-256 hex (unique). Sai dạng / không có → **404**.
- **Hết hiệu lực → 410** "Link đã hết hạn hoặc bị thu hồi": hết hạn, thu hồi, **mọi trang được chọn đều đã xoá** (phạm vi `pages`), dự án đóng (mở lại dự án → link còn hạn dùng lại được).
  Phạm vi `all` mà sổ tay trống → cây rỗng (không 410), FE hiện "Chưa có trang nào".
- **Mật khẩu** tuỳ chọn 4–100 ký tự, lưu băm bằng `PasswordHasher<WikiShareLink>` (ASP.NET Identity, như mật khẩu tài khoản). `POST …/unlock` đúng → cookie riêng của link
  `oh_wshare_{linkId:N}` (HttpOnly, SameSite Lax, Secure khi https, path `/api/projects/public/wiki-shares`), giá trị = Id link mã hoá bằng DataProtection có hạn
  = min(24 giờ, hạn link). Sai → 400; sai ≥ 5 lần / 15 phút / (link, IP) hoặc ≥ 30 lần / 15 phút / link → **429** (đếm trong bộ nhớ Api — `WikiShareUnlockGuard`, khởi động lại thì đếm lại).
  Chưa mở khoá → `GET /{token}` trả `locked: true`, không có cây; `GET …/pages/{id}` → 401.
- **Nhật ký mở**: mỗi lần `GET /{token}` xem được nội dung (không cần mật khẩu hoặc đã mở khoá) → một dòng `wiki_share_views` (thời điểm, IP, User-Agent ≤ 300 ký tự) + `ViewCount` / `LastViewedAt`.
  Xem nhật ký: người tạo link, quản lý dự án, HR (không qua token AI).
- **Thông báo** người tạo link (chuông, không email — `NotificationCategories.WikiShareViewed`, catalog `projects.wiki_share_viewed`): lần mở đầu tiên, hoặc thiết bị mới
  (cặp IP + User-Agent chưa gặp với link này); tối đa **1 lần / giờ / link** (`LastNotifiedAt`). Tiêu đề nêu phạm vi ("toàn bộ sổ tay" / "\"Trang\" và N trang khác").
  Link chuông: phạm vi `all` → `/projects/{id}?tab=wiki`; phạm vi `pages` → trang được chọn đầu tiên (thứ tự sổ tay).
- **Link Markdown giữa các trang** (`RewriteLinks`): url có `page={guid}` và `/projects/` hoặc `tab=wiki` → trang trong bản chia sẻ đổi thành `/s/{token}?page={id}`;
  trang ngoài (ngoài cây, dự án khác, đã xoá) đổi thành `wiki-share:not-shared` (FE hiện chữ thường, không lộ id nội bộ). Link khác giữ nguyên.

## Schema `projects` (migration `WikiShareLinks`, `WikiShareScope`)

- `wiki_share_links` (`[Audited]` — `TokenHash` / `PasswordHash` tự che trong lịch sử): `Id`, `ProjectId` (FK cascade → `projects`), `Scope` (`all` | `pages`, TEST-230),
  `RootPageId?` (FK restrict → `wiki_pages`; link kiểu cũ — không dùng nữa, link mới để null), `Label` ≤ 200, `RecipientName` ≤ 200, `TokenHash` (64, unique `ux_wiki_share_links_token`), `PasswordHash?`, `ExpiresAt`, `RevokedAt` + `RevokedByName`,
  `CreatedAt` / `CreatedByUserId` (tài khoản nhận chuông) / `CreatedByName`, `ViewCount`, `LastViewedAt`, `LastNotifiedAt`. Index `ix_wiki_share_links_project_page` (ProjectId, RootPageId).
- `wiki_share_link_pages` (TEST-230): PK (`LinkId`, `PageId`), `LinkId` FK cascade, `PageId` FK restrict → `wiki_pages`, `IncludeChildren`. Migration `WikiShareScope` chép mỗi link cũ
  thành `Scope = pages` + một dòng (`RootPageId`, `IncludeChildren`) rồi bỏ cột `IncludeChildren` — **link đã gửi khách vẫn dùng được, token / URL không đổi**.
- `wiki_share_views`: `Id`, `LinkId` (FK cascade), `At`, `Ip` (64), `UserAgent` (300). Index `ix_wiki_share_views_link_at` (LinkId, At).

## API

| Route | Ai | Ghi chú |
|---|---|---|
| `POST /api/projects/{id}/wiki/shares` `{scope, pages: [{pageId, includeChildren}], days?, expiresOn?, label?, recipientName?, password?}` | quản lý dự án / HR, cookie | → `{id, token, expiresAt, share}`; `scope` trống = `pages`; `pageId` + `includeChildren` (cũ) = viết tắt một trang; sai → 400 (`pages` / `scope`) |
| `GET /api/projects/{id}/wiki/shares?pageId=` | quản lý dự án / HR | mọi link của dự án, mới nhất trước, không token; `pageId` tuỳ chọn = chỉ link có chứa trang đó (kể cả qua kèm con / toàn bộ); `scope`, `pageCount`, `pages` [{id, title, includeChildren, deleted}], `status` active / expired / revoked / gone, `hasPassword`, `viewCount`, `lastViewedAt` |
| `DELETE /api/projects/{id}/wiki/shares/{shareId}` | quản lý dự án / HR | thu hồi (204, lặp lại vẫn 204) |
| `GET /api/projects/{id}/wiki/shares/{shareId}/views?page=&pageSize=` | người tạo link, quản lý dự án, HR | `{items: [{at, ip, userAgent}], total, page, pageSize}` (≤ 100 / trang) |
| `GET /api/projects/public/wiki-shares/{token}` | ẩn danh | `{projectName, rootPageId, pages: [{id, parentId, title}], expiresAt, recipientName, requiresPassword, locked, notSharedHref}` — `rootPageId` = trang đầu của cây (null khi cây rỗng), `parentId` theo cây chia sẻ |
| `POST …/public/wiki-shares/{token}/unlock` `{password}` | ẩn danh | 204 + cookie; sai 400; quá số lần 429 |
| `GET …/public/wiki-shares/{token}/pages/{pageId}` | ẩn danh | `{id, parentId, title, summary, content, updatedAt, path}` — content đã đổi link; trang ngoài bản chia sẻ 404 |

Nhóm công khai `AllowAnonymous` (không dùng cookie đăng nhập), rate-limit **60 request / phút / IP / đường dẫn** (policy `projects-wiki-share`, đăng ký ở `ProjectsModule`),
mọi phản hồi có `X-Robots-Tag: noindex, nofollow` + `Cache-Control: no-store`. Không trả tên người sửa, id dự án hay trang ngoài bản chia sẻ.

## Giao diện (TEST-229)

Nút "Chia sẻ" ở tab Sổ tay (quản lý dự án / HR) → hộp thoại tạo link + danh sách link của trang + thu hồi + nhật ký xem; chuông có nhãn riêng;
trang công khai `/s/$token` (`features/wiki-share`). Chi tiết: [projects-wiki-share-ui.md](projects-wiki-share-ui.md).

## Kiểm thử

- `WikiShareRulesTests` (quyền, hạn + ngày tự chọn theo giờ VN + trần 90 ngày, mật khẩu, trạng thái 410, cookie ≤ 24 giờ, giới hạn nhập sai, chống báo lặp, cây chia sẻ, đổi link;
  TEST-230: cây theo phạm vi, nối tổ tiên gần nhất, trang con tạo sau, 410 khi xoá hết trang chọn, kiểm tra `Selection`),
  `AccessTokenScopeTests` (4 route quản lý bị chặn với token AI), `NotificationCatalogTests` (hằng mới có trong catalog).
- E2E `scripts/dev/wiki-share-e2e.ts` — **chỉ DB tạm** (sửa hạn / lần báo bằng SQL qua `docker exec`), lệnh ở đầu file — 57/57 (2026-11-25, chạy lại sau khi đổi `/s/`).
- E2E giao diện `scripts/dev/wiki-share-ui-e2e.ts` (Chrome headless, chỉ DB tạm) — 59/59 (2026-11-25, chạy lại sau TEST-230).
- E2E phạm vi TEST-230 `scripts/dev/wiki-share-scope-e2e.ts` (REST + hạ / nâng migration để thử link cũ, chỉ DB tạm) — 41/41; giao diện `wiki-share-scope-ui-e2e.ts` — 28/28 (2026-11-25).
