# Kiểm tra token Facebook BM định kỳ + báo token hỏng (TEST-205)

> Nguồn sự thật là code: `Infrastructure/SocialService.cs` (`SocialTokenCheckJob`, `CheckAndSyncAsync`, `MarkTokenInvalidAsync`), `Domain/SocialRules.cs`
> (`TokenCheckInterval`, `MarksTokenInvalid`, `ShouldAlertTokenInvalid`, `TokenAlertRecipients`). Về [assets-social.md](assets-social.md).

## Job `SocialTokenCheckJob` (`assets.social-token-check` · "Tài sản: kiểm tra token Facebook BM")

- Chạy 3 phút sau khi Api khởi động (`TokenCheckFirstDelay`), sau đó mỗi **5 giờ** (`SocialRules.TokenCheckInterval`). Giả định một instance Api như `SocialPublishJob`.
- Mỗi BM **Đang dùng** có token: một scope riêng → `CheckAndSyncAsync` = `GET /me` + đồng bộ trang + làm mới quyền ([assets-social-permissions.md](assets-social-permissions.md)), cập nhật `TokenCheckedAt`. Lỗi một BM không chặn BM khác (lần chạy báo lỗi ở Hệ thống → Vận hành kèm số BM lỗi).
- BM ngừng dùng / không có token → bỏ qua.
- `Facebook__TokenCheckInterval` (vd `00:00:05`) **chỉ dùng khi test**: rút cả chu kỳ lẫn lần chạy đầu. Production không đặt.

## Khi nào token bị coi là hỏng

- Facebook trả lỗi **không tạm thời** (`SocialRules.MarksTokenInvalid` = không phải `IsTransient`: 190, 102, 200…) → `TokenStatus = Invalid` + lý do; danh sách quyền cũ giữ nguyên.
- Lỗi mạng / hết giờ chờ / lỗi tạm thời của Facebook (mã 1, 2, 4, 17, 32, 341, 368, 613, HTTP 5xx / 429) → **giữ nguyên trạng thái**, không báo (tránh báo nhầm mỗi 5 giờ). Áp cho mọi lần gọi `CheckAndSyncAsync` (job, HR đồng bộ / thay token / thêm BM).
- Đăng bài bị 190 / 102 (`SocialPublishJob`) → cũng qua cùng hàm.

## Thông báo (một hàm dùng chung `MarkTokenInvalidAsync`)

- Chỉ khi token **chuyển** sang lỗi (`ShouldAlertTokenInvalid`: trạng thái trước khác `Invalid`); đang lỗi rồi thì job 5 giờ không báo lại. HR thay token → `None` → kiểm tra: hợp lệ thì không báo; hỏng lần sau lại báo.
- Người nhận (`TokenAlertRecipients`, bỏ trùng): người đang giữ BM (còn làm việc) + **mọi HR + mọi Quản trị viên** (trước TEST-205: chỉ HR, không có HR mới tới admin).
- Chuông + email, category `social_post`, tiêu đề `Token BM "<tên>" không còn dùng được`, link `/assets?tab=social`. Danh mục: `assets.social_post` trong `NotificationCatalog`.

## Giao diện

- Sheet BM, mục Token System User: dòng nhỏ "Tự kiểm tra mỗi 5 giờ — token hỏng sẽ báo người giữ BM, HR và Quản trị viên." (BM đang dùng có token); "Kiểm tra lúc" lấy `TokenCheckedAt` do job cập nhật.
- Tab MXH: BM đang dùng có token lỗi → hộp cảnh báo đỏ đầu bảng (`data-testid="social-token-broken"`, liệt kê tên BM); trên điện thoại (cột Token ẩn) badge "Token lỗi" hiện dưới tên BM.

## Test

`SocialRulesTests` (chu kỳ, chỉ báo khi chuyển sang lỗi, lỗi tạm thời không tính, bỏ trùng người nhận) · `scripts/dev/social-token-check-e2e.ts` 18/18 trên DB tạm + Mailpit (2026-11-22) — [e2e.md](../e2e.md).
