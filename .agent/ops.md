# Vận hành — trang Hệ thống → tab Vận hành

> Nguồn sự thật là code: `backend/src/OfficeHub.Api/OpsReport.cs`, `BuildingBlocks/Hosting/JobMonitor.cs`, `Notification/.../EmailOutbox.cs`; FE `features/system/components/ops-tab`. Về [architecture.md](architecture.md).

Tab **Vận hành** (`GET /api/system/ops`, chỉ admin, `OfficeHub.Api/OpsReport.cs`):
- **Phiên bản**: `scripts/deploy.sh` đặt `GIT_SHA` + `BUILD_TIME` → build-arg của `backend/Dockerfile` (env `OFFICEHUB_COMMIT/BUILD_TIME`, chung image Api / Realtime / MCP) và
  `frontend/Dockerfile` (`VITE_APP_COMMIT/BUILD_TIME`). Dev: lấy sha trong `AssemblyInformationalVersion`. Web khác back-end → nhắc tải lại trang.
- **Sao lưu**: liệt kê `s3://{S3__BucketBackup}/{KeyPrefix}backup/db|keys/` → bản mới nhất, số bản; quá 26 giờ → "Quá hạn".
- **Hàng đợi email**: `Notification.Contracts.IEmailOutbox` (đang chờ, đã gửi 24 giờ, bỏ cuộc / bỏ qua 30 ngày, 15 lỗi gần nhất; POST `ops/email/retry` đưa thư bỏ cuộc vào hàng đợi lại).
- **Job nền**: `BuildingBlocks/Hosting/JobMonitor` (singleton, trong bộ nhớ của tiến trình). Job mới: `monitor.Register(key, tên, chu kỳ)` đầu `ExecuteAsync`, bọc mỗi lần chạy
  `await job.RunAsync(() => RunOnceAsync(stop))` → hiện lần chạy cuối, lỗi; quá 2 chu kỳ chưa chạy xong = "Trễ". Job của Realtime không có ở đây.
