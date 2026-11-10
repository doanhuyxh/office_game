# Cấp tài khoản cho nhân viên (module Organization)

> Nguồn sự thật là code (`Features/Employees/AccountEndpoints.cs`). Về [organization.md](organization.md) · đăng nhập / mật khẩu: [auth.md](auth.md).

## Cấp tài khoản (`Features/Employees/AccountEndpoints.cs`, đều cần HR)

| Method | Path | Body / kết quả |
|---|---|---|
| POST | `/employees/{id}/account` | `{ mode: "invite" \| "password", userName?, roles? }` → 200 `{ userId, userName, tempPassword, inviteSent }` |
| POST | `/employees/{id}/account/resend-invite` | 204 |
| POST | `/employees/{id}/account/reset-password` | 200 `{ tempPassword }` |
| PUT | `/employees/{id}/account/roles` | `{ roles[] }` → 204 |
| POST | `/employees/{id}/account/reset-2fa` | 204 — đặt lại xác thực 2 lớp (mất điện thoại); chưa bật → 409 `"Tài khoản chưa bật xác thực 2 lớp"` |
| PUT | `/employees/{id}/account/bot` | `{ isBot }` → 204 — đánh dấu tài khoản bot (hiện trong văn phòng 3D khi gọi MCP, không đổi quyền): [office-bots.md](office-bots.md) |

- `userName` trống → dùng `Code`. Email tài khoản lấy từ `employee.Email`.
- `roles` luôn được thêm `employee` và bỏ trùng (`NormalizeRoles`).
- **Mật khẩu tạm** (`GenerateTempPassword`): 10 ký tự thường + HOA + số, bỏ ký tự dễ nhầm. Chỉ trả về **một lần**, không lưu ở đâu khác.
- Thứ tự (giữ nguyên khi sửa): **1)** tạo tài khoản → **2)** ghi `employee.UserId` → **3)** `SendInviteAsync` (chế độ invite). Email lỗi ở bước 3 thì tài khoản vẫn đã gắn, HR bấm "Gửi lại lời mời".

| Trường hợp | Kết quả |
|---|---|
| Nhân viên đã có tài khoản | 409 `"Nhân viên đã có tài khoản"` |
| Nhân viên đã nghỉ | 409 `"Nhân viên đã nghỉ việc"` |
| `invite` mà chưa có email | 400 (`mode`) `"Nhân viên chưa có email, hãy nhập email hoặc chọn cấp mật khẩu tạm"` |
| `invite` mà SMTP lỗi | 502 `"Đã tạo tài khoản nhưng gửi email thất bại. Kiểm tra cấu hình SMTP rồi bấm 'Gửi lại lời mời'."` (tài khoản đã gắn, `invitePending`) |
| `resend-invite` mà SMTP lỗi | 502 `"Gửi email thất bại. Kiểm tra cấu hình SMTP rồi thử lại."` |
| `mode` khác | 400 `"Chọn 'invite' (mời qua email) hoặc 'password' (mật khẩu tạm)"` |
| Lỗi từ Identity (trùng tên đăng nhập / email…) | 400, key `account` |

### Bảo vệ vai trò admin (cố ý chặn)

| Thao tác | Bị chặn khi | Thông báo (403) |
|---|---|---|
| Cấp vai trò `admin` (tạo tài khoản / đổi vai trò) | người gọi không phải admin | `"Chỉ admin được cấp vai trò admin"` |
| Đổi vai trò của một admin | người gọi không phải admin | `"Chỉ admin được đổi vai trò của admin"` |
| Đặt lại mật khẩu của một admin | người gọi không phải admin | `"Chỉ admin được đặt lại mật khẩu của admin"` |
| Admin tự gỡ vai trò admin | luôn | `"Không thể tự gỡ vai trò admin của chính mình"` |
| Đặt lại 2FA của một admin | người gọi không phải admin | `"Chỉ admin được đặt lại xác thực 2 lớp của admin"` |
| Tự đặt lại 2FA của chính mình | luôn (phiên bị chiếm không được tự gắn điện thoại khác) | `"Không thể tự đặt lại xác thực 2 lớp của chính mình — nhờ admin / HR khác"` |

Đổi vai trò có hiệu lực khi người đó đăng nhập lại (security stamp đổi); được cấp admin / hr mà chưa bật 2FA → bị buộc bật ([auth-2fa.md](auth-2fa.md)).

Đặt lại 2FA (`IAccountService.ResetTwoFactorAsync`): tắt 2FA, xoá khoá + mã dự phòng, mở khoá đăng nhập, đăng xuất mọi phiên; gửi người đó thông báo `account_security` (chuông + email, `INotifier`). Admin / hr bị buộc bật lại ở lần đăng nhập sau, token AI của họ ngừng tới khi bật. `AccountSummary.twoFactorEnabled` cho cột Tài khoản ("· 2FA") và menu "Đặt lại 2FA".
