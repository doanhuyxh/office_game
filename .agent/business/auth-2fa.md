# Xác thực 2 lớp (TOTP)

> Nguồn sự thật là code: `Identity/Features/Auth/TwoFactorEndpoints.cs`, `Identity/Domain/TwoFactorRules.cs`, `BuildingBlocks/Auth/TwoFactorGate.cs`, `frontend/src/features/auth/`. Về [auth.md](auth.md) · [README.md](README.md).

Chủ dự án chốt 2026-11-07: **ứng dụng TOTP** (Google / Microsoft Authenticator…), **bắt buộc với admin / HR**, tuỳ chọn với người khác — admin mở rộng phạm vi bắt buộc ở Hệ thống → Cấu hình → Bảo mật → Xác thực 2 lớp (TEST-258, xem dưới). Dùng sẵn `AuthenticatorTokenProvider` + mã dự phòng của ASP.NET Identity (RFC 6238, SHA-1, 30 giây, 6 số, chấp nhận lệch ±2 bước). Khoá + mã dự phòng lưu ở `identity.user_tokens` (`LoginProvider = "[AspNetUserStore]"`, `AuthenticatorKey` / `RecoveryCodes`) — **không có migration**; cờ là `users.TwoFactorEnabled`.

## Endpoint (đăng nhập, cookie; token AI bị chặn vì không có trong danh sách route AI)

| Method | Path | Kết quả |
|---|---|---|
| GET | `/api/auth/2fa/status` | `{ enabled, required, recoveryCodesLeft }` (`required` = bắt buộc theo `TwoFactorPolicy`) |
| POST | `/api/auth/2fa/setup` | `{ reset=false }` → `{ sharedKey, authenticatorUri }`. Chưa có khoá chờ (hoặc `reset`) → tạo khoá mới (đổi security stamp → cấp lại cookie phiên hiện tại); có rồi → trả lại khoá đó (mở trang 2 lần không đổi mã QR). Đã bật → 409 |
| POST | `/api/auth/2fa/enable` | `{ code }` → `{ recoveryCodes[10] }` **một lần**; mã sai → 400 key `code`; đã bật → 409; chưa setup → 409 |
| POST | `/api/auth/2fa/disable` | `{ currentPassword, code }` → 204; xoá khoá + mã dự phòng. **Admin / hr → 409** (bắt buộc). Sai mật khẩu → 400 `currentPassword`, sai mã → 400 `code` |
| POST | `/api/auth/2fa/recovery-codes` | `{ code }` → 10 mã mới (mã cũ hết hiệu lực) |
| POST | `/api/auth/login/2fa` | ẩn danh: `{ code, isRecoveryCode=false, rememberMe=true }` → 200 `MeResponse` + cookie |

- `sharedKey`: base32 nhóm 4 ký tự thường; `authenticatorUri` = `otpauth://totp/{App__Name}:{email hoặc userName}?secret=…&issuer={App__Name}&digits=6`.
- Mã người dùng gõ: bỏ khoảng trắng / gạch (TOTP); mã dự phòng (`XXXXX-XXXXX`) nhận chữ thường, thiếu gạch.
- `enable` / `disable` / `recovery-codes` / `login/2fa` rate limit `RateLimits.Auth` (30 / phút / IP + path).

## Đăng nhập 2 bước

1. `POST /auth/login` mật khẩu đúng + đã bật 2FA → **403 `title: "2fa_required"`** + cookie tạm `officehub.2fa` (scheme `Identity.TwoFactorUserId`, HttpOnly, **5 phút**, `AuthCookie.ConfigureTwoFactor`). Chưa có cookie đăng nhập.
2. `POST /auth/login/2fa`: cookie tạm hết hạn / không có → 401 `2fa_expired` (FE quay về bước mật khẩu); mã sai → 401 `2fa_invalid`; khoá → 423.
- **Mã sai (TOTP lẫn mã dự phòng) cộng vào số lần sai** chung với mật khẩu: N lần → khoá M phút (cấu hình Bảo mật → Mật khẩu, mặc định 5 / 15). Identity không đếm mã dự phòng → code tự gọi `AccessFailedAsync`. Đúng → reset bộ đếm, ghi `LastLoginAt`.
- Mã dự phòng dùng **một lần**. Đăng nhập bằng mã dự phòng vẫn cấp cookie theo `rememberMe`.
- Không có "ghi nhớ thiết bị này" (không dùng cookie `TwoFactorRememberMe`).

## Ai bắt buộc (`TwoFactorPolicy`, TEST-258)

- **Admin / HR luôn bắt buộc** (kể cả tài khoản bot có vai trò đó). Nhóm cấu hình `two_factor` (`settings.system_settings`, chỉ admin, `PUT /api/system/settings/two_factor` `{ values: { scope } }`) mở rộng: `admin_hr` (mặc định, chưa lưu = giá trị này) · `managers` (+ vai trò manager) · `all` (mọi tài khoản người thật). **Bot** (`users.IsBot`) không bị phạm vi mở rộng bắt.
- Đọc qua `RuntimeConfig.TwoFactor` (cache 30 giây, lưu trên trang xoá cache ngay). Claim `must_setup_2fa` tính lại ở **mọi request** từ ảnh chụp `AuthCache` (`UserAuthSnapshot.ToIdentity(…, TwoFactorSettings)`) → đổi phạm vi có hiệu lực ở request kế tiếp, không cần đăng xuất. Token AI / OAuth `/token` / `/2fa/status` / `/2fa/disable` / `MeResponse.mustSetupTwoFactor` cùng một hàm.

- `AppClaimsFactory` thêm claim `must_setup_2fa = "true"` khi tài khoản bắt buộc mà `TwoFactorEnabled = false`. Security stamp kiểm mọi request → claim tính lại mỗi request; được cấp vai trò hr / admin → stamp đổi → đăng nhập lại là bị buộc ngay.
- `MeResponse` có `twoFactorEnabled`, `mustSetupTwoFactor`. Vẫn **đăng nhập được** (như `mustChangePassword`), FE `requireAuth` chuyển sang `/setup-2fa`.
- **BE chặn** (`app.UseTwoFactorEnrollmentGate()` ngay sau `UseAuthentication` trong `OfficeHub.Api/Program.cs`): phiên có claim gọi `/api/*` → **403 `title: "2fa_setup_required"`**, `"Cần bật xác thực 2 lớp trước khi tiếp tục (bắt buộc với tài khoản của bạn)"`. Miễn (khớp chính xác path): `/api/auth/me`, `logout`, `login`, `login/2fa`, `change-password`, `forgot-password`, `reset-password`, `2fa/status`, `2fa/setup`, `2fa/enable`.
- Realtime: `OfficeRoomHub` từ chối kết nối khi cookie có `must_setup_2fa` (giống `must_change_password`).
- **Token AI** (quyết định 2026-11-07): tài khoản bắt buộc chưa bật 2FA → `AccessTokenHandler` từ chối **mọi** token `ohk_…` của người đó (kể cả token cũ) → 401 `TwoFactorPolicy.TokenBlockedMessage`; OAuth `/token` (đổi mã / refresh) → `invalid_grant` cùng câu. Tạo token mới bị cổng 403. Bật 2FA xong → token cũ hoạt động lại. Người không thuộc phạm vi bắt buộc không bật 2FA vẫn dùng token bình thường.
- Đã bật thì tài khoản bắt buộc **không tự tắt** được (409 `CannotDisableMessage`); đổi điện thoại = nhờ admin / HR khác đặt lại.

## HR đặt lại 2FA (mất điện thoại)

`POST /api/org/employees/{id}/account/reset-2fa` (policy HR) → `IAccountService.ResetTwoFactorAsync`: tắt 2FA, xoá khoá + mã dự phòng, mở khoá đăng nhập, đổi security stamp (mọi phiên bị đăng xuất). Chi tiết + bảo vệ admin: [organization-accounts.md](organization-accounts.md). Người bị đặt lại nhận thông báo `account_security` (chuông + email qua hàng đợi, link `/profile`).

## Lịch sử sửa

`AppUser` là `[Audited]` → bật / tắt / đặt lại ghi trường `TwoFactorEnabled` (`Xác thực 2 lớp`). Khoá và mã dự phòng nằm ở `user_tokens` (không audit) → **không bao giờ** vào nhật ký.

## UI (`frontend/src/features/auth/`)

| Component | Ở đâu | Ghi chú |
|---|---|---|
| `TwoFactorLoginStep` | `/login` bước 2 (khi 403 `2fa_required`) | input `#totp-code` / `#recovery-code`, nút "Dùng mã dự phòng", "← Đăng nhập lại" |
| `TwoFactorSetupPage` | `/setup-2fa` (`requireTwoFactorSetup`: cần phiên, mật khẩu tạm → đổi trước) | QR (`qrcode.react`), khoá nhập tay + sao chép, `#totp-code`, "Tạo mã QR mới" (`reset`), bắt buộc → nút "Đăng xuất", tự nguyện → "Huỷ" |
| `RecoveryCodesPanel` | sau khi bật / tạo lại | 10 mã, sao chép, tải `.txt`; phải tick "Tôi đã lưu mã dự phòng" mới "Tiếp tục" |
| `TwoFactorCard` | `/profile` | trạng thái, số mã dự phòng còn lại, bật (→ `/setup-2fa?returnUrl=/profile`), tạo lại mã, tắt (ẩn khi `required`) |

- `App.tsx`: query / mutation nhận 403 `2fa_setup_required` → làm mới `me` + chuyển `/setup-2fa?returnUrl=…` (không toast).
- HR: menu "Đặt lại 2FA" ở bảng nhân viên (chỉ khi `account.twoFactorEnabled`, không với chính mình, HR không thấy với tài khoản admin) + `AlertDialog` xác nhận; cột Tài khoản ghi "· 2FA".
- E2E: `scripts/dev/twofa-e2e.ts` (TOTP bằng `scripts/dev/totp.ts`) — [../e2e.md](../e2e.md).
