# Biến môi trường (`.env`)

> Về [commands.md](commands.md) · [AGENTS.md](../AGENTS.md). Thêm biến → Settings có `ErrorMessage = "Thiếu X__Y trong .env"`, cập nhật `.env.example` + bảng dưới.

## Biến môi trường

Một file `.env` ở gốc repo cho BE + Docker Compose. Quy ước `Section__Key` ↔ `Section:Key`. Biến môi trường đã có sẵn **không bị ghi đè** bởi `.env`. Thiếu biến bắt buộc → app dừng với thông báo `Thiếu <Tên__Biến> trong .env`.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `App__Name`, `App__BaseUrl` | ✔ | Tên app; URL public (dùng trong link email mời/quên mật khẩu) |
| `ConnectionStrings__Default` | ✔ | Postgres (Npgsql). Thiếu → `Thiếu ConnectionStrings__Default trong .env` |
| `POSTGRES_DB/USER/PASSWORD` | compose | Chỉ cho container postgres |
| `Database__MigrateOnStartup` | – (mặc định true) | Tự chạy migration khi Api khởi động |
| `Seed__AdminEmail`, `Seed__AdminPassword`, `Seed__AdminFullName` | khi DB chưa có admin | Tạo admin đầu tiên |
| `DataProtection__KeysPath` | ✔ | Thư mục khoá mã hoá cookie. Api và Realtime **phải dùng chung**. Đường dẫn tương đối tính từ thư mục chứa `.env` |
| `Encryption__Key` | ✔ | Base64 của 32 byte (`openssl rand -base64 32`), AES-256-GCM cho trường nhạy cảm (lương hợp đồng). **Mất / đổi khoá = mất dữ liệu đã mã hoá** → sao lưu cùng DB. Sai định dạng → app dừng |
| `Office__TimeZone` | ✔ | Múi giờ tính công (`Asia/Ho_Chi_Minh`) |
| `Office__IpRanges` | – | CIDR, cách nhau dấu phẩy. Trống → mọi lần chấm công là "Remote" |
| `Office__InactiveMinutes` | – | Khai báo nhưng **chưa được code dùng** |
| `S3__Region`, `S3__AccessKey`, `S3__SecretKey`, `S3__BucketFiles` | ✔ | S3 cho file nghiệp vụ |
| `S3__ServiceUrl`, `S3__ForcePathStyle` | – | Để trống/false với AWS; điền khi dùng S3-compatible (RustFS, MinIO) |
| `S3__KeyPrefix` | – | Thư mục gốc trong bucket (bucket dùng chung dự án khác) |
| `S3__PresignMinutes` | – (5) | Hạn presigned URL |
| `S3__BucketBackup`, `S3__BucketWeb` | script | Dùng bởi `infra/backup/backup.sh`, `frontend/scripts/upload-web-s3.sh` |
| `Smtp__Host`, `Smtp__FromEmail` | ✔ | SMTP (MailKit, timeout 15s mỗi lần gửi). `Smtp__Port/UseSsl/Username/Password/FromName` tuỳ chọn. Cổng 587 ↔ `UseSsl=false` (STARTTLS), 465 ↔ `UseSsl=true` |
| `Smtp__CheckCertificateRevocation` | – (true) | Kiểm tra thu hồi chứng chỉ TLS. Chủ dự án có thể đặt `false` trên máy dev macOS nếu Gmail báo "incomplete certificate revocation check" |
| `LiveKit__Url/ApiKey/ApiSecret` | – | Thiếu → voice trả 503. Secret < 32 ký tự → Realtime không khởi động |
| `LIVEKIT_NODE_IP` | `127.0.0.1` | Chỉ dev compose (`--node-ip`). Không đặt → LiveKit báo IP container, trình duyệt báo "Không kết nối được máy chủ voice". Test từ máy khác trong LAN → IP LAN + đổi `LiveKit__Url` theo |
| `Seq__Url`, `Seq__ApiKey`, `Sentry__Dsn` | – | Log / lỗi; trống = tắt |
| `SystemTools__LogsUrl`, `SystemTools__MailUrl` | – | Link trên trang **Hệ thống** (admin). Trống: log = `http://localhost:5341` (chỉ Development), mail suy từ `Smtp__Host` (localhost/mailpit → Mailpit :8025, Gmail → mail.google.com) |
| `Chat__InternalKey` | ✔ | Khoá nội bộ Realtime ↔ Api cho module Chat (header `X-Chat-Key`, dùng để cấp quyền xem kênh chat phòng). Tối thiểu 32 ký tự (`openssl rand -base64 32`); **cả Api và Realtime phải cùng giá trị** (compose dùng chung `.env`). Thiếu / ngắn → Api và Realtime không khởi động ([business/chat.md](business/chat.md)) |
| `Realtime__MapPath` | – | Mặc định `shared/office-map.json` |
| `Realtime__ApiBaseUrl` | – (`http://localhost:5080`) | Realtime gọi Api để kiểm tra phiên. Prod compose: `http://api:8080` |
| `Attendance__Reminders__Enabled`, `__Email`, `__GraceMinutes`, `__FlexibleAt`, `__NextMorningAt` | – (true, false, 30, 21:00, 08:00) | Nhắc quên chấm ra ([business/attendance-corrections.md](business/attendance-corrections.md)) |
| `AccessTokens__Enabled`, `AccessTokens__RequestsPerMinute` | – (true, 120) | Công tắc kết nối AI toàn công ty; giới hạn request / phút / token |
| `Mcp__ApiBaseUrl`, `Mcp__TokenCacheSeconds` | – (`http://localhost:5080`, 30) | OfficeHub.Mcp gọi lại Api bằng token người dùng; prod compose: `http://api:8080` |
| `Realtime__SessionCheckSeconds` | – (30, tối thiểu 5) | Chu kỳ kiểm tra lại phiên người đang online |
| `APP_DOMAIN`, `HTTP_PORT`, `POSTGRES_HOST/PORT`, `SEQ_URL`, `SEQ_ADMIN_PASSWORD`, `SEQ_BIND` | prod | Chỉ cho `infra/docker-compose.yml`. Seq (`--profile logs`): `SEQ_URL=http://seq:5341` (mạng Docker nội bộ); `COMPOSE_PROFILES=logs` để `scripts/deploy.sh` / mọi lệnh compose đều tạo container Seq (thiếu → không có Seq, proxy logs báo 502); `SEQ_BIND` = địa chỉ mở giao diện `:5341` (mặc định `127.0.0.1`; proxy ở VPS khác qua Tailscale → IP Tailscale của máy chạy compose) |
| `LiveKit__ApiUrl` | – (suy ra từ `LiveKit__Url`) | URL HTTP nội bộ tới API LiveKit; prod compose đặt `http://livekit:7880` |

FE (`frontend/.env`, không có bí mật): `VITE_API_TARGET`, `VITE_RT_TARGET` (đích proxy khi dev), `VITE_SENTRY_DSN` (khai báo, chưa dùng).

**Kiểm tra key đúng/sai:** `GET http://localhost:5080/health/ready` thử kết nối Postgres, S3 (list `{KeyPrefix}files/`), SMTP. `/health` chỉ báo còn sống.

## S3 CORS (kho tài liệu)

Kho tài liệu ([business/documents.md](business/documents.md)) cho trình duyệt **PUT thẳng** lên bucket `S3__BucketFiles` bằng presigned URL → bucket cần CORS (không có: tải lên báo "Không gửi được file lên kho S3", `documents-e2e.ts` in ⚠). Xem / tải (GET) không cần CORS. **Chủ dự án đã bật CORS 2026-11-07.** JSON đã dùng (IAM user `OfficeHub` của app không có quyền `PutBucketCors`; sửa trong AWS Console → S3 → bucket → Permissions → CORS):

```json
[{ "AllowedOrigins": ["https://office.lokid.me", "http://localhost:5173"], "AllowedMethods": ["PUT", "GET", "HEAD"],
   "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 }]
```

