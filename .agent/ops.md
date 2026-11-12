# Vận hành — trang Hệ thống → tab Vận hành

> Nguồn sự thật là code: `backend/src/OfficeHub.Api/OpsReport.cs`, `BuildingBlocks/Hosting/JobMonitor.cs`, `Notification/.../EmailOutbox.cs`; FE `features/system/components/ops-tab`. Về [architecture.md](architecture.md).

Tab **Vận hành** (`GET /api/system/ops`, chỉ admin, `OfficeHub.Api/OpsReport.cs`):
- **Phiên bản**: `scripts/deploy.sh` đặt `GIT_SHA` + `BUILD_TIME` → build-arg của `backend/Dockerfile` (env `OFFICEHUB_COMMIT/BUILD_TIME`, chung image Api / Realtime / MCP) và
  `frontend/Dockerfile` (`VITE_APP_COMMIT/BUILD_TIME`). Dev: lấy sha trong `AssemblyInformationalVersion`. Web khác back-end → nhắc tải lại trang.
  Dòng **Múi giờ** = `Office__TimeZone` + độ lệch UTC (`BuildInfoDto.TimeZone/UtcOffset`); mọi mốc thời gian trên tab hiện kèm `GMT+7` (`formatDateTimeTz`).
- **Sao lưu**: liệt kê `s3://{S3__BucketBackup}/{KeyPrefix}backup/db|keys/` → bản mới nhất, số bản; quá 26 giờ → "Quá hạn"; bản mới nhất không phải `.age` → cảnh báo "chưa mã hoá". `infra/backup/backup.sh` (TEST-16): mã hoá bằng age (`BACKUP_AGE_RECIPIENT`), upload `--sse AES256`, khoá DataProtection chỉ đẩy lên khi đã mã hoá; cách khôi phục ở đầu file.
- **Hàng đợi email**: `Notification.Contracts.IEmailOutbox` (đang chờ, đã gửi 24 giờ, bỏ cuộc / bỏ qua 30 ngày, 15 lỗi gần nhất; POST `ops/email/retry` đưa thư bỏ cuộc vào hàng đợi lại).
- **Job nền**: `BuildingBlocks/Hosting/JobMonitor` (singleton, trong bộ nhớ của tiến trình). Job mới: `monitor.Register(key, tên, chu kỳ)` đầu `ExecuteAsync`, bọc mỗi lần chạy
  `await job.RunAsync(() => RunOnceAsync(stop))` → hiện lần chạy cuối, lỗi; quá 2 chu kỳ chưa chạy xong = "Trễ". Job của Realtime không có ở đây.

## Xoay khoá mã hoá trường

`Encryption__Key` (AES-256-GCM cho lương, CCCD, số tài khoản, token MXH, secret webhook) xoay được (TEST-17, `BuildingBlocks/Security/FieldEncryptor.cs`):

1. `openssl rand -base64 32` → khoá mới. Trong `.env`: `Encryption__PreviousKeys=k1:<khoá đang dùng>` (thêm vào nếu đã có, cách nhau `;`), `Encryption__Key=<khoá mới>`, `Encryption__KeyId=k2` (id chưa dùng).
2. Khởi động lại Api. Dữ liệu cũ vẫn đọc được; ghi mới dùng `k2`. Job **"Mã hoá lại dữ liệu sang khoá hiện hành"** (`security.reencrypt`, 60 s sau khởi động rồi 6 giờ / lần, xem ở Hệ thống → Vận hành) chuyển mọi cột đã khai báo (`AddEncryptedColumns` ở từng module) sang `v2:k2:`, ghi bằng `ExecuteUpdate` (không sinh lịch sử sửa).
3. Khi log `Mã hoá lại …` không còn xuất hiện (và không có lỗi "không giải mã được") → bỏ khoá cũ khỏi `PreviousKeys`, khởi động lại. Sao lưu `.env` mới cùng DB.

Thêm cột mã hoá mới → khai báo `services.AddEncryptedColumns<TContext, TEntity>(nameof(...))` trong module, nếu không job bỏ sót cột đó. E2E: `scripts/dev/key-rotation-e2e.ts`.
