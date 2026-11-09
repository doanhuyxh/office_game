# Tài khoản mạng xã hội + đăng bài (module Assets)

> Nguồn sự thật là code: `backend/src/Modules/Assets/` (`Domain/Social*.cs`, `Features/Social*.cs`, `Infrastructure/FacebookGraph.cs`, `SocialService.cs`), FE `features/assets` (tab MXH) + `features/social` (trang `/social`). Về [assets.md](assets.md) · [README.md](README.md).

## Phạm vi (chủ dự án chốt 2026-11-09)

- Loại tài sản thứ 3 cạnh thiết bị / dịch vụ: **tài khoản mạng xã hội**. Làm **Facebook Business Manager trước** (công ty có nhiều BM); Zalo OA / TikTok để sau (Zalo cá nhân không có API; TikTok chưa kiểm duyệt app chỉ đăng riêng tư).
- Mỗi BM lưu trong DB và **bàn giao cho một nhân viên cụ thể**; người giữ đăng bài thẳng từ hệ thống lên các Fanpage của BM.
- Không lưu mật khẩu Facebook. Lưu **token System User** (mã hoá AES-GCM bằng `Encryption__Key`, `IFieldEncryptor`) — ngoại lệ có chủ đích so với "không lưu bí mật" của Tài sản. Token chỉ ghi, không bao giờ trả ra API; lịch sử sửa (`[Audited]`) tự che vì tên cột kết thúc `Encrypted`.

## Dữ liệu (schema `assets`, migration `AssetsSocialAccounts`)

| Bảng | Cột chính |
|---|---|
| `social_accounts` `[Audited]` | `Platform` (Facebook), `Name`, `ExternalId` (ID BM, chữ số, duy nhất khi có), `LoginHint` (email / SĐT quản trị), `OwnerDepartmentId`, `Status` (Active / Disabled), `HolderEmployeeId`, `TokenEncrypted`, `TokenStatus` (None / Valid / Invalid), `TokenError`, `TokenCheckedAt`, `TokenOwnerName`, `PagesSyncedAt` |
| `social_account_assignments` | lịch sử bàn giao: chỉ thêm / đóng (`AssignedAt/By`, `ReturnedAt/By`, ghi chú) |
| `social_pages` | Fanpage đồng bộ từ BM: `ExternalId`, `Name`, `Category`, `Link`, `PictureUrl`, `TokenEncrypted` (page token), `IsActive` (false = không còn trong BM, giữ cho lịch sử). Duy nhất `(AccountId, ExternalId)` |
| `social_posts` | `Message`, `Link`, `ScheduledAt` (null = đăng ngay), tác giả (user / employee / tên). Không sửa — huỷ rồi tạo lại |
| `social_post_targets` | mỗi trang một dòng: `Status` Pending → Publishing → Published / Failed; Pending → Cancelled. `DueAt`, `Attempts`, `ExternalPostId`, `Permalink`, `Error`, `Cancelled*` |
| `social_media` | ảnh / video S3 `assets/social/{yyyyMM}/{id}/…`: xin link → PUT → xác nhận (HEAD); gắn `PostId` khi tạo bài |

Trạng thái bài tính từ các đích (`SocialRules.PostStatus`): Đang đăng › Chờ đăng › Đã đăng / Lỗi một phần / Lỗi / Đã huỷ.

## Quyền

| Ai | Được |
|---|---|
| HR / admin | Quản lý BM (thêm, sửa, token, đồng bộ, bàn giao / thu hồi, ngừng dùng); đăng lên mọi trang của BM đang dùng; xem / huỷ / đăng lại mọi bài |
| Người đang giữ BM | Đăng lên trang của BM đó; xem / huỷ / đăng lại bài trên trang của mình (kể cả bài HR đăng) |
| Nhân viên khác | Không thấy trang, đăng → 403; bài của người khác → 404 |
| Token AI | Không mở (route `/api/assets/social/*` không có trong danh sách cho phép của `AccessTokenAuth`) |

Thu hồi BM → huỷ bài **đang chờ** của người bị thu hồi trên các trang của BM (ghi lý do); bài HR vẫn chờ. Ngừng dùng (phải thu hồi trước) → huỷ mọi bài chờ. Người bị thu hồi vẫn xem bài mình đã đăng.

## Facebook Graph API (`FacebookGraph`, mặc định `v23.0`)

- Token đi qua header `Authorization: Bearer` (không nằm trong URL → không lọt log HTTP). Phân trang `/me/accounts` bằng cursor `after`, **không** theo link `next` (link đó chứa token).
- Lưu / thay token → `GET /me` + `GET /me/accounts?fields=…,access_token` → lưu trang + page token. Trang thiếu `access_token` → `canPost = false` ("Thiếu quyền đăng"). Lỗi Facebook → `TokenStatus = Invalid` + lý do (vẫn lưu token); lỗi mạng không đổi trạng thái.
- Đăng: chỉ chữ / link → `/{page}/feed`; 1 ảnh → `/photos` (`url`, `caption`); nhiều ảnh (≤ 10) → `/photos published=false` từng ảnh rồi `/feed` + `attached_media[i]`; 1 video (≤ 1 GB) → `graph-video…/{page}/videos` (`file_url`). Facebook tự tải tệp từ link S3 có hạn 2 giờ. Sau đó `GET /{id}?fields=permalink_url` (tương đối → thêm `https://www.facebook.com`).
- Cấu hình tuỳ chọn (không cần `.env`): `Facebook__GraphUrl`, `Facebook__VideoUrl`, `Facebook__ApiVersion` — chỉ đổi khi test (máy chủ giả).

## Job `SocialPublishJob` (Api, 30 giây hoặc ngay khi có bài "Đăng ngay" / đăng lại — `SocialPublishSignal`; giả định một instance)

- Nhận đích nguyên tử (Pending → Publishing, `Attempts + 1`) rồi gọi Graph.
- Lỗi tạm thời (mã 1, 2, 4, 17, 32, 341, 368, 613, HTTP 5xx / 429) hoặc không kết nối được → thử lại sau 1 rồi 5 phút, tối đa 3 lần. Hết giờ chờ (có thể đã lên trang) → Lỗi, **không** tự đăng lại. Đích kẹt "Đang đăng" > 15 phút (Api dừng giữa chừng) → Lỗi "không rõ kết quả".
- Lỗi token (190, 102) → BM "Token lỗi" + chuông/email HR + người giữ (một lần mỗi lần chuyển sang lỗi). Thiếu quyền (10 / 200) chỉ lỗi bài.
- Đăng thất bại → chuông `social_post` cho người đăng (chỉ app).

## Endpoint (`/api/assets/social`)

| Method | Path | Ai |
|---|---|---|
| GET/POST | `/accounts` · GET/PUT `/accounts/{id}` | HR. POST nhận `token?` (kiểm tra + đồng bộ ngay) |
| PUT | `/accounts/{id}/token` `{ token }` · POST `/accounts/{id}/sync` | HR |
| POST | `/accounts/{id}/assign` `{ employeeId, note? }` · `/return` `{ note? }` · `/status` `{ status }` | HR |
| GET | `/pages` | trang người xem được đăng |
| POST | `/media` `{ fileName, size }` → presigned PUT · `/media/{id}/confirm` · GET `/media/{id}/url` | người có trang |
| GET/POST | `/posts?page=&pageSize=` (phân trang) · GET `/posts/{id}` | theo quyền ở trên |
| POST | `/posts/{id}/cancel` · `/targets/{id}/retry` | |

Kiểm tra bài (`SocialRules.ValidatePost`): có chữ / link / tệp; ≤ 63 206 ký tự; link http(s) và không kèm ảnh / video; 1–50 trang; ≤ 10 ảnh hoặc đúng 1 video; hẹn giờ từ +2 phút tới +180 ngày.

## Front-end

- `/assets` tab **MXH** (HR, sau Dịch vụ): bảng BM → sheet chi tiết (token chỉ ghi + hướng dẫn tạo token System User, Đồng bộ trang, người giữ, trang, lịch sử). "Của tôi" + hồ sơ nhân viên + cảnh báo nghỉ việc hiện BM đang giữ.
- `/social` **Đăng bài MXH** (`features/social`): trái soạn bài (chọn trang theo BM, nội dung, link hoặc ảnh / video tải thẳng S3, hẹn giờ giờ VN), phải danh sách bài + kết quả từng trang (link bài, lỗi, Đăng lại, Huỷ); tự làm mới 4 giây khi đang đăng. Menu chỉ hiện với HR và người có ít nhất một trang (`useNavigation`).

## Test

`SocialRulesTests` (29) · `scripts/dev/social-e2e.ts` (máy chủ Graph giả trong cùng tiến trình, PUT S3 thật) 68/68 trên DB tạm 2026-11-09 — [e2e.md](../e2e.md). **Chưa thử với Facebook thật** (cần chủ dự án tạo app + System User token) và chưa thử tay giao diện trên trình duyệt.

## Chưa làm

Zalo OA, TikTok, Instagram; sửa bài đã hẹn; số liệu tương tác / bình luận; `appsecret_proof` (đừng bật "Require App Secret" trong app Meta); BM chưa có trong Rà soát quyền / Excel.
