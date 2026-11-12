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
