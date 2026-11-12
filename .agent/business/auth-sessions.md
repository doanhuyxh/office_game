# Huỷ phiên & token AI

> Rà soát bảo mật TEST-12 (2026-11-12). Về [auth.md](auth.md) · token AI [mcp.md](mcp.md) · OAuth [mcp-oauth.md](mcp-oauth.md).

## Khi nào phiên / token bị huỷ

| Sự kiện | Cookie web (đổi security stamp) | Token AI + ứng dụng OAuth (`AiAccessRevoker.RevokeAllAsync`) |
|---|---|---|
| Đăng xuất (`POST /auth/logout`) | ✔ đổi stamp **trước** `SignOutAsync` → bản sao cookie cũng chết | ✘ (đăng xuất web không ngắt AI) |
| Đăng nhập (mỗi lúc 1 thiết bị) | ✔ | ✘ |
| Tự đổi mật khẩu (`/auth/change-password`) | ✔ (`ChangePasswordAsync`) rồi cấp lại cookie cho chính thiết bị | ✔ |
| Đặt mật khẩu qua link (quên / mời) | ✔ (`ResetPasswordAsync`) | ✔ |
| HR cấp mật khẩu tạm | ✔ | ✔ + **chuông + email** "Mật khẩu đã được đặt lại" cho chính chủ (không gửi khi tự đặt cho mình) |
| HR đặt lại 2FA | ✔ | ✔ (chuông + email đã có từ trước) |
| Khoá tài khoản (`SetActiveAsync(false)`) | ✔ | ✔ — mở lại tài khoản **không** làm sống lại token cũ |
| Đổi vai trò | ✔ | ✘ (token đọc vai trò hiện tại mỗi request) |

Thu hồi = đặt `RevokedAt` (giữ dòng để còn dấu vết) cho mọi `AccessToken` (PAT + access token OAuth) và `OAuthGrant` (refresh token) của user. Refresh OAuth đã kiểm `grant.IsActive` → không cần so security stamp (stamp đổi cả mỗi lần đăng nhập nên không dùng làm điều kiện cho token AI).

⚠ Tài khoản **bot**: HR cấp lại mật khẩu / khoá → token của agent ngừng hoạt động, phải tạo token mới.

## Mật khẩu tạm bị chặn ở server

`UsePasswordChangeGate()` (`BuildingBlocks/Auth/TwoFactorGate.cs`, đặt trước `UseTwoFactorEnrollmentGate` trong `OfficeHub.Api/Program.cs`): cookie có claim `must_change_password = "true"` → mọi `/api/*` trừ danh sách miễn của cổng 2FA (`me`, `logout`, `login`, `login/2fa`, `change-password`, `forgot/reset-password`, `2fa/status|setup|enable`) trả **403 `password_change_required`**. FE (`App.tsx`) gặp title này → chuyển `/change-password`. Trước đây chỉ guard FE chặn. Token AI của tài khoản mật khẩu tạm đã bị `AccessTokenHandler` từ chối; hub Realtime đã từ chối từ trước.

## Tạo token AI cần xác nhận lại

`POST /api/auth/access-tokens` nhận thêm `confirm` = **mật khẩu hiện tại hoặc mã 2FA 6 số** (6 chữ số + đã bật 2FA → kiểm TOTP; còn lại → mật khẩu). Bỏ qua khi **vừa đăng nhập ≤ 10 phút** (`ReauthRules.IsRecentLogin(LastLoginAt)`) — an toàn nhờ "mỗi lúc 1 thiết bị": đăng nhập mới làm chết mọi cookie cũ, nên phiên hiện tại chính là lần đăng nhập đó (script e2e đăng nhập rồi tạo token ngay vẫn chạy). Sai → 400 `errors.confirm` + `AccessFailedAsync` (5 lần → khoá 15 phút như đăng nhập sai). FE: ô "Xác nhận" bắt buộc trong `create-token-dialog`.

Test: `tests/OfficeHub.Modules.Identity.Tests/ReauthRulesTests.cs`.

## Đăng nhập & hạn mức

> TEST-20 (2026-11-12). Bảng tóm tắt ở [auth.md](auth.md#đăng-nhập-loginasync).

- **Không khoá tài khoản của người khác được**: đăng nhập gọi `PasswordSignInAsync(lockoutOnFailure: false)`; `LoginThrottle` (singleton, RAM — `Infrastructure/AttemptCounter.cs`) đếm sai theo **id tài khoản + IP** (5 lần / 15 phút → chỉ IP đó bị chặn với tài khoản đó; đúng mật khẩu → xoá đếm của IP) và theo tài khoản (30 lần / giờ từ mọi IP → chặn cả tài khoản, chống dò phân tán). Không tìm thấy tài khoản → đếm theo chuỗi nhập.
- **Phản hồi đồng nhất**: mọi thất bại trả 401 `LoginFailedMessage`; tài khoản không tồn tại băm mật khẩu giả. Chỉ khi **đúng** mật khẩu mới thấy `2fa_required` (bước 2FA vẫn trả 423 khi khoá — người đó đã biết mật khẩu).
- **Quên mật khẩu**: 204 ngay, email gửi nền (`PasswordResetMailer`, hàng đợi RAM 100) → thời gian như nhau dù email có tài khoản hay không; 3 email / địa chỉ / giờ (`AttemptCounter`, đếm cả email không tồn tại). Link 1 giờ (provider `PasswordReset1h`); link mời 72 giờ dùng provider `Default` + mục đích `Invite`, `/auth/reset-password` thử token đặt lại trước, sai và tài khoản **chưa có mật khẩu** thì thử token mời (chấp nhận cả token mời cũ mục đích `ResetPassword`).
- **Đổi mật khẩu / tắt 2FA**: sai mật khẩu hiện tại → `AccessFailedAsync` (5 lần → khoá 15 phút), đang khoá thì từ chối kể cả nhập đúng; `change-password` thêm rate limit `Auth`.
- **Trần chung cho cookie**: `GlobalLimiter` 600 request / phút / người dùng (`RateLimits.CookieRequestsPerMinute`) → 429.
- Chưa làm: CAPTCHA (cân nhắc nếu thấy tấn công thật).

Test: `LoginThrottleTests`; e2e `scripts/dev/security-e2e.ts` (40/40, DB tạm + Mailpit, hướng dẫn đầu file).
