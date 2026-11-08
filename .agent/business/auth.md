# Đăng nhập & tài khoản (module Identity)

> Nguồn sự thật là code (`backend/src/Modules/Identity/`, `frontend/src/features/auth/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Việc **cấp tài khoản cho nhân viên** do HR làm ở module Organization → [organization.md](organization.md). File này mô tả đăng nhập, cookie, mật khẩu, và `IAccountService`.

## Endpoint (`Features/Auth/AuthEndpoints.cs`, `PasswordEndpoints.cs`)

| Method | Path | Auth | Kết quả |
|---|---|---|---|
| POST | `/api/auth/login` | ẩn danh, rate limit | `{ login, password, rememberMe=true }` → 200 `MeResponse` + cookie |
| POST | `/api/auth/logout` | đăng nhập | 204, xoá cookie |
| GET | `/api/auth/me` | đăng nhập | `MeResponse { id, userName, email, fullName, roles[], mustChangePassword, avatar, twoFactorEnabled, mustSetupTwoFactor }`; 401 nếu user không tồn tại hoặc `IsActive=false`. `avatar` = nhân vật 3D (null = mặc định) |
| PUT / DELETE | `/api/auth/avatar` | đăng nhập | Lưu / bỏ nhân vật 3D của chính mình — [office-avatar.md](office-avatar.md) |
| POST | `/api/auth/change-password` | đăng nhập | `{ currentPassword, newPassword }` → 204; sai → 400 ValidationProblem (key = mã lỗi Identity) |
| POST | `/api/auth/forgot-password` | ẩn danh, rate limit | `{ email }` → **luôn 204** |
| POST | `/api/auth/reset-password` | ẩn danh, rate limit | `{ userId, token, newPassword }` → 204 |
| POST | `/api/auth/login/2fa`, `/api/auth/2fa/*` | | Xác thực 2 lớp → [auth-2fa.md](auth-2fa.md) |

## Đăng nhập (`LoginAsync`)

- `login` khớp `UserName` trước, rồi `Email` (`FindByNameAsync` ?? `FindByEmailAsync`). Tên đăng nhập của nhân viên mặc định = mã nhân viên (`NV001`).
- Không tìm thấy hoặc `IsActive=false` → 401 `"Sai tài khoản hoặc mật khẩu"` (không phân biệt để tránh dò tài khoản).
- Bị khoá → **423** `"Tài khoản tạm khoá do đăng nhập sai nhiều lần, thử lại sau 15 phút"`.
- Đã bật 2FA → 403 `title: "2fa_required"` + cookie tạm → bước 2 `POST /auth/login/2fa`. Admin / hr chưa bật → vào được nhưng bị buộc bật ([auth-2fa.md](auth-2fa.md)).
- Thành công → cập nhật `LastLoginAt`.
- **Mỗi lúc chỉ 1 thiết bị** (chốt 2026-11-08): đăng nhập thành công (bước mật khẩu nếu không 2FA, hoặc sau khi xác thực 2FA xong) → `UserManager.UpdateSecurityStampAsync` đổi security stamp rồi `RefreshSignInAsync` cấp lại cookie cho **chính thiết bị vừa đăng nhập**. Thiết bị khác (nếu đang mở) có cookie mang stamp cũ → bị 401 ở request kế tiếp (cùng cơ chế "Kiểm tra security stamp ở mọi request" bên dưới) → FE tự chuyển về `/login` (`App.tsx`, `onUnauthorized`). Áp dụng cho web; **không** ảnh hưởng token AI (`ohk_…`, scheme Bearer riêng, không qua stamp cookie). Mở nhiều tab **cùng** trình duyệt vẫn bình thường (không đăng nhập lại = không đổi stamp).

| Quy tắc | Giá trị (`IdentityModule.cs`) |
|---|---|
| Mật khẩu | ≥ 8 ký tự, có chữ số, có chữ thường; không bắt buộc chữ hoa / ký tự đặc biệt |
| Khoá | 5 lần sai → khoá 15 phút |
| Rate limit (`RateLimits.Auth`) | 30 request / phút / (IP + path) cho login, forgot-password, reset-password → 429 |
| Token link email | `DataProtectionTokenProviderOptions.TokenLifespan` = 72 giờ; dùng một lần (đổi security stamp) |

## Cookie (`BuildingBlocks/Auth/AuthCookie.cs`)

- Scheme `Identity.Application`, tên `officehub.auth`, `HttpOnly`, `SameSite=Lax`, `Secure` theo request, hạn 7 ngày **trượt**.
- Chưa đăng nhập / thiếu quyền → **401 / 403** (không redirect).
- **Kiểm tra security stamp ở mọi request** (`SecurityStampValidatorOptions.ValidationInterval = TimeSpan.Zero` trong `IdentityModule.cs`): khoá tài khoản, đổi vai trò, cấp lại mật khẩu tạm → cookie cũ bị từ chối ngay ở request kế tiếp. Đổi lại sẽ mở lại lỗ hổng "khoá chưa có hiệu lực".
- Claim thêm (`AppClaimsFactory`): `full_name`; `must_change_password = "true"` khi đang dùng mật khẩu tạm; `must_setup_2fa = "true"` khi admin / hr chưa bật 2FA.
- OfficeHub.Realtime đọc cùng cookie ([office.md](office.md)); claim `must_change_password` / `must_setup_2fa` làm hub từ chối kết nối.

## Token truy cập cho AI

`/api/auth/access-tokens` (tạo / liệt kê / thu hồi) và scheme Bearer `AccessToken` (scheme mặc định là policy `OfficeHub`: Bearer `ohk_…` → token, còn lại cookie) → [mcp.md](mcp.md).

## Mật khẩu tạm / lời mời / quên mật khẩu

| Luồng | Cách làm | Sau đó |
|---|---|---|
| HR cấp mật khẩu tạm | `CreateWithPasswordAsync` → `MustChangePassword = true` | Đăng nhập được, FE bắt sang `/change-password`. Đổi xong → cờ về false, `RefreshSignInAsync` cấp cookie mới |
| HR mời qua email | `CreateInvitedAsync` (user **không có mật khẩu**) → bên gọi lưu liên kết → `SendInviteAsync` gửi link `{App__BaseUrl}/accept-invite?uid=&token=` | Không đăng nhập được tới khi đặt mật khẩu |
| Quên mật khẩu | `/forgot-password`: chỉ gửi nếu user tồn tại, `IsActive`, có email; lỗi SMTP chỉ ghi log | Link `{App__BaseUrl}/reset-password?uid=&token=` |
| Đặt mật khẩu qua link | `/reset-password` (dùng chung cho mời + quên) | `EmailConfirmed = true`, `MustChangePassword = false`, mở khoá |

- Token sai / hết hạn / đã dùng, hoặc user bị khoá → 400 `"Link không hợp lệ hoặc đã hết hạn"`. Mật khẩu yếu → 400 ValidationProblem key `newPassword`.
- Email gửi bằng `AccountService.SendLinkAsync` (HTML, nút "Đặt mật khẩu" / "Đặt lại mật khẩu", kèm tên đăng nhập). Tiêu đề: `"Lời mời tham gia {App__Name}"`, `"Đặt lại mật khẩu {App__Name}"`.

## `IAccountService` (project `Identity.Contracts`, impl `Infrastructure/AccountService.cs`)

Module khác **chỉ** thao tác tài khoản qua interface này.

| Hàm | Lỗi trả về (`AccountResult.Errors`) |
|---|---|
| `CreateWithPasswordAsync(NewAccount, tempPassword)` | `"Tên đăng nhập '{x}' đã tồn tại"`, `"Email '{x}' đã có tài khoản"`, `"Vai trò không hợp lệ: …"`, lỗi mật khẩu Identity |
| `CreateInvitedAsync(NewAccount)` | như trên + `"Cần email để gửi lời mời"`. **Không gửi email** |
| `SendInviteAsync(userId)` (gửi / gửi lại) | `"Không tìm thấy tài khoản"`, `"Tài khoản đã đặt mật khẩu, không cần mời lại"`, `"Tài khoản không có email"`; SMTP lỗi → **không ném**, trả `Code = AccountErrors.EmailFailed` |
| `ResetToTempPasswordAsync(userId, temp)` | đặt mật khẩu mới + `MustChangePassword`, mở khoá, **đổi security stamp** |
| `SetRolesAsync(userId, roles)` | thay toàn bộ vai trò, **đổi security stamp** |
| `ResetTwoFactorAsync(userId)` | tắt 2FA + xoá khoá / mã dự phòng, mở khoá, **đổi security stamp**; `"Tài khoản chưa bật xác thực 2 lớp"` |
| `SetActiveAsync(userId, active)` | `false` → đổi security stamp |
| `GetAsync` / `GetManyAsync` | `AccountInfo { …, InvitePending = PasswordHash == null, TwoFactorEnabled }` |

Vai trò hợp lệ: `Roles.All` = `admin`, `hr`, `manager`, `employee`. Tạo tài khoản không truyền vai trò → `employee`.

## Admin đầu tiên (`Infrastructure/IdentitySeeder.cs`)

Khởi động Api: migrate → tạo 4 vai trò → nếu chưa có user vai trò `admin`: tạo từ `Seed__AdminEmail`/`Seed__AdminPassword`/`Seed__AdminFullName` với vai trò `admin` + `hr`. Thiếu biến → Api dừng: `"Chưa có tài khoản admin. Điền Seed__AdminEmail và Seed__AdminPassword trong .env rồi khởi động lại."`. Admin này **không có hồ sơ nhân viên** → không chấm công được; lần đăng nhập đầu **bị buộc bật 2FA** ([auth-2fa.md](auth-2fa.md)).

## UI (`frontend/src/features/auth/`)

| Component | Route | Ghi chú |
|---|---|---|
| `LoginForm` | `/login` | input `#login`, `#password`; link "Quên mật khẩu?"; 403 `2fa_required` → bước mã (`TwoFactorLoginStep`); sau đăng nhập → `/change-password` nếu `mustChangePassword`, `/setup-2fa` nếu `mustSetupTwoFactor`, ngược lại `safeReturnPath(returnUrl)` hoặc `/` |
| `ChangePasswordForm` | `/change-password` | kiểm tra "nhập lại" khớp ở client; lỗi server hiện `ApiError.messages` |
| `ForgotPasswordForm` | `/forgot-password` | luôn hiện "Nếu email … có tài khoản…" khi thành công |
| `SetPasswordForm` (`AcceptInviteForm`, `ResetPasswordForm`) | `/accept-invite`, `/reset-password` | đọc `uid`, `token` từ query |

Hook: `useMe`, `meQuery`, `useLogin`, `useChangePassword`, `useForgotPassword`, `useResetPassword`, `useLogout`; tiện ích `hasRole(me, ...roles)` (`features/auth/index.ts`). Guard: `routes/guards.ts`. 2FA (`TwoFactorSetupPage`, `TwoFactorCard`…): [auth-2fa.md](auth-2fa.md).
