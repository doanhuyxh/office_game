# Script E2E (`scripts/dev/`)

> Chạy từ gốc repo. `TEST_PASSWORD` = mật khẩu trong `account.txt`. Về [progress.md](progress.md) · lệnh chung [commands.md](commands.md).

| Script | Việc |
|---|---|
| `seed-org.ts` | Tạo lại phòng ban + 12 tài khoản thử + ghi `account.txt` (bỏ qua cái đã có) |
| `seed-contracts.ts` | Hợp đồng mẫu cho tài khoản thử |
| `office-e2e.ts` (+ `cdp.ts`) | 2 Chrome headless vào `/office`: tìm đường, va chạm tường, ngồi / đứng, ghế đã có người, đồng bộ vị trí, lỗi console. Dùng hook dev `window.__officeScene` |
| `mcp-e2e.ts` | Token AI: tạo / thu hồi, route bị chặn (hợp đồng, tạo token, `/leave/balances`), MCP 401 khi thiếu token, `tools/list`, gọi tool đọc + chấm công (Remote) + gửi rồi huỷ đơn nghỉ. Cần Api + `OfficeHub.Mcp` đang chạy |
| `mcp-oauth-e2e.ts` | OAuth cho AI qua Vite :5173: discovery, DCR, đồng ý, PKCE, refresh xoay vòng, dùng lại mã / refresh token, nhật ký AI, HR xem + thu hồi. Cần Api + Mcp + Vite |
| `phase2-e2e.ts <mẫu.docx>` | Giai đoạn 2 (Api :5080): Excel bảng công / tăng ca / phép + quyền, tiền tăng ca / phép, mẫu hợp đồng (upload, trường bị tách run, xuất .docx — chỉ hợp đồng tài khoản thử), đặt phòng (múi giờ, trùng giờ, sát giờ, mời + thông báo, huỷ). Cần `fflate` (có trong `frontend/node_modules` → chạy từ `frontend/`) |
| `prod-smoke.ts` | Bản đã deploy (`BASE_URL`), chỉ đọc — xem [commands.md](commands.md#ci--deploy) |
| `phase3-e2e.ts <dir> a\|b` | Nhập Excel (lỗi từng dòng, quản lý trong file), lịch sử sửa (che lương, vai trò), nhắc quên chấm ra (pha b sau khi khởi động lại Api). **Tạo dữ liệu thật → chỉ chạy trên DB tạm** (`E2E_LOCAL_DB=1`) |
| `voice-e2e.ts` | 2 Chrome micro giả: nghe gần / huỷ nhận âm khi xa, phím M, đổi kênh vào phòng họp, server không cấp token phòng khi đứng ngoài, chia sẻ màn hình, `VoiceGuard` đẩy client không đổi kênh. Cần container `livekit` (`docker compose … up -d livekit`). Hook `window.__officeVoice` |
| `office-chat-e2e.ts` | 2 Chrome: chat toàn văn phòng, chat phòng (chỉ người trong phòng nhận, khu mở bị từ chối), joystick / zoom trên màn cảm ứng giả lập |
| `payroll-sign-e2e.ts` | Ký điện tử (PDF, OTP qua Mailpit, sai mã, không đồng ý, ký, SHA bản đã ký, huỷ) + bảng lương (thông số, hồ sơ thuế, kỳ, khoản cộng/trừ, Excel, chốt, phiếu của tôi, chặn token AI). **Chỉ DB tạm + Mailpit** (hướng dẫn trong đầu file) |

## Test trên DB tạm (khi test tạo dữ liệu không xoá được, vd nhân viên)

`docker run -d --name officehub-e2e-pg -e POSTGRES_DB=officehub_e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=<tuỳ ý> -p 127.0.0.1:55432:5432 postgres:18-alpine` → chạy Api với `ConnectionStrings__Default=Host=127.0.0.1;Port=55432;…` (tự migrate + tạo admin từ `Seed__*`) → test → `docker rm -f officehub-e2e-pg`. S3 / SMTP vẫn là dịch vụ thật trong `.env`.
Cần đọc email (OTP ký): thêm container Mailpit (`axllent/mailpit`, SMTP 11025, API 18025) và chạy Api với `Smtp__Host=127.0.0.1 Smtp__Port=11025 Smtp__UseSsl=false Smtp__Username= Smtp__Password=` → không gửi email thật.

