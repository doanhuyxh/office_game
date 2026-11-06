# Ký hợp đồng điện tử (ký nội bộ + OTP email)

Chủ dự án chốt 2026-11-06: **ký nội bộ** (không qua nhà cung cấp chữ ký số / CA), xác thực người ký bằng **OTP gửi email**. Phù hợp ký giữa công ty và nhân viên trong hệ thống; nếu cần chữ ký số có giá trị pháp lý cao hơn (USB token / remote signing) thì làm riêng sau.

## Luồng

1. HR có hợp đồng với **file PDF** (xuất từ mẫu Word rồi lưu PDF, tải lên mục file) → menu ⋯ "Gửi ký điện tử". Nhân viên phải có tài khoản. Mỗi hợp đồng chỉ một yêu cầu Pending.
2. Hệ thống lưu SHA-256 bản gốc, gửi chuông `contract_sign_requested` (+ email theo quy tắc thông báo) → nhân viên thấy banner trên trang Hợp đồng.
3. Nhân viên mở bản gốc (presigned URL) → "Gửi mã qua email" → nhập OTP 6 số + vẽ chữ ký (canvas, PNG) + tick đồng ý → ký.
4. BE kiểm tra OTP, **tải lại bản gốc và so SHA** (HR thay file sau khi gửi → từ chối), `PdfSigner.Stamp`: chân trang mọi trang ghi "Đã ký điện tử bởi …" + **trang chứng nhận** (người ký, mã NV, email, thời điểm giờ VN, IP, trình duyệt, SHA bản gốc, mã yêu cầu, phương thức xác thực, ảnh chữ ký). Font Noto Sans nhúng (`Resources/Fonts`, OFL) để có dấu tiếng Việt.
5. Lưu `contracts/{emp}/{contract}/signed/{rid}/signature.png` + `hop-dong-da-ky.pdf`; **bản đã ký thành file chính thức của hợp đồng** (bản gốc vẫn còn, khoá lưu ở yêu cầu ký), ghi `SignedDate` nếu trống, chuông `contract_signed` cho HR.

## Quy tắc (`Domain/SignRequest.cs` → `SignRules`, test `SignRulesTests`)

- Yêu cầu hết hạn sau 7 ngày (trạng thái Pending / Signed / Cancelled / Expired).
- OTP: 6 số ngẫu nhiên (`RandomNumberGenerator`), chỉ lưu `HashOtp(requestId, otp)`, sống 10 phút, gửi lại cách nhau ≥ 60 giây, tối đa 5 lần gửi, 5 lần nhập sai → phải gửi mã mới.
- Chữ ký: data URL `image/png`, ≤ 300 KB.
- Chỉ **người ký** gửi OTP / ký (HR gọi → 404); HR tạo / huỷ yêu cầu; xem tài liệu: người ký hoặc HR.
- Email OTP gửi **thẳng** qua `IEmailSender` (không qua hàng đợi thông báo, không áp `EmailPolicy`). Lỗi SMTP → 503.

## API (`Features/SignEndpoints.cs`, nhóm `/api/contracts`)

| | Đường dẫn | Ghi chú |
|---|---|---|
| HR | `POST /{id}/sign-requests` | 409 nếu chưa có PDF / nhân viên chưa có tài khoản / đang có yêu cầu chờ |
| Mọi người | `GET /sign-requests?contractId=` | HR thấy tất cả, nhân viên thấy của mình; `canSign` |
| HR | `DELETE /sign-requests/{rid}` | Huỷ yêu cầu Pending |
| Người ký / HR | `GET /sign-requests/{rid}/document?signed=` | `{ url, name }` presigned |
| Người ký | `POST /sign-requests/{rid}/otp` | → `{ sentTo (che), expiresAt }` |
| Người ký | `POST /sign-requests/{rid}/sign` | `{ otp, signature, agree }` |

Bảng `contracts.sign_requests` [Audited] (xem [database-workflow.md](../database-workflow.md)). Token AI không gọi được (`/api/contracts` bị chặn trong `AccessTokenAuth`).

## UI (`features/contracts/components/SignPanel.tsx`)

`PendingSignBanner` (đầu trang Hợp đồng, cả HR khi chính họ là người ký), `SignDialog` (3 bước + đồng ý), `SignaturePad` (pointer events, `touch-none`, mực xanh trên nền trắng), `SignRequestList` (lịch sử ký trong chi tiết hợp đồng, link "Bản đã ký", HR huỷ).

Test E2E: `scripts/dev/payroll-sign-e2e.ts` (DB tạm + Mailpit đọc OTP).
