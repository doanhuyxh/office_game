# Cấp tài khoản cho nhân viên (module Organization)

> Nguồn sự thật là code (`Features/Employees/AccountEndpoints.cs`). Về [organization.md](organization.md) · đăng nhập / mật khẩu: [auth.md](auth.md).

## Cấp tài khoản (`Features/Employees/AccountEndpoints.cs`, đều cần HR)

| Method | Path | Body / kết quả |
|---|---|---|
| POST | `/employees/{id}/account` | `{ mode: "invite" \| "password", userName?, roles? }` → 200 `{ userId, userName, tempPassword, inviteSent }` |
| POST | `/employees/{id}/account/resend-invite` | 204 |
| POST | `/employees/{id}/account/reset-password` | 200 `{ tempPassword }` |
| PUT | `/employees/{id}/account/roles` | `{ roles[] }` → 204 |

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

Đổi vai trò có hiệu lực khi người đó đăng nhập lại (security stamp đổi).
