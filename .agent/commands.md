# Lệnh, biến môi trường, deploy

> Nguồn sự thật: `frontend/package.json`, `backend/*.slnx`, `infra/*.yml`, `.env.example`, `.github/workflows/ci.yml`. Về [AGENTS.md](../AGENTS.md).

## Công cụ

| Công cụ | Phiên bản | Ghi chú |
|---|---|---|
| .NET SDK | 10.0 (`backend/global.json`: `10.0.201`, rollForward latestFeature) | |
| Bun | 1.x | **Package manager của FE là bun** (`frontend/bun.lock`). Không dùng npm/pnpm |
| Docker | — | Hạ tầng dev và production |

## Chạy dev

```bash
# 1) Hạ tầng phụ (Postgres + S3 trong .env đang trỏ tới dịch vụ thật → không cần container postgres/s3)
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d mailpit seq livekit
#    Chạy offline hoàn toàn: bỏ danh sách service (bật cả postgres, s3=RustFS, s3-init) và trỏ .env về localhost

# 2) Back-end (2 terminal, chạy từ backend/)
dotnet run --project src/OfficeHub.Api        # http://localhost:5080  (profile "http")
dotnet run --project src/OfficeHub.Realtime   # http://localhost:5090

# 3) Front-end (từ frontend/)
bun install
bun run dev                                   # http://localhost:5173, proxy /api → 5080, /rt → 5090 (ws)
```

`EnvLoader.Load()` tìm `.env` ngược từ thư mục hiện tại → chạy `dotnet` ở đâu trong repo cũng đọc được `.env` gốc.

## Build / test / kiểm tra

| Việc | Lệnh | Thư mục |
|---|---|---|
| Build BE (như CI) | `dotnet build -warnaserror` | `backend/` |
| Test BE | `dotnet test` (OfficeHub.Architecture.Tests, OfficeHub.Modules.Attendance.Tests, OfficeHub.Modules.Leave.Tests) | `backend/` |
| Typecheck FE | `bun run typecheck` (`tsc -b`) | `frontend/` |
| Build FE | `bun run build` (`tsc -b && vite build`) | `frontend/` |
| Sinh type từ OpenAPI | `bun run api:generate` (Orval → `src/types/generated/`, thư mục **chưa tồn tại** tới khi chạy lần đầu; cần Api đang chạy) | `frontend/` |
| Thêm component shadcn | `bunx shadcn@latest add <tên>` → vào `src/components/common/` | `frontend/` |

FE **không có lint/test runner** (không có ESLint, Vitest). Kiểm tra = `bun run build`.

## Migration EF Core

Mỗi module một DbContext/schema. Tool cục bộ `dotnet-ef` (`backend/dotnet-tools.json`). Từ `backend/`:

```bash
dotnet ef migrations add <TenMigration> \
  --project src/Modules/<M>/OfficeHub.Modules.<M> \
  --startup-project src/OfficeHub.Api \
  --context <DbContext> -o Infrastructure/Migrations
```

DbContext hiện có: `OfficeIdentityDbContext`, `OrgDbContext`, `AttendanceDbContext`, `ApprovalDbContext`, `LeaveDbContext`. Migration tự chạy khi Api khởi động nếu `Database__MigrateOnStartup=true`. Chi tiết: [database.md](database.md).

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
| `Seq__Url`, `Seq__ApiKey`, `Sentry__Dsn` | – | Log / lỗi; trống = tắt |
| `Realtime__MapPath` | – | Mặc định `shared/office-map.json` |
| `Realtime__ApiBaseUrl` | – (`http://localhost:5080`) | Realtime gọi Api để kiểm tra phiên. Prod compose: `http://api:8080` |
| `Realtime__SessionCheckSeconds` | – (30, tối thiểu 5) | Chu kỳ kiểm tra lại phiên người đang online |
| `APP_DOMAIN`, `VOICE_DOMAIN`, `ACME_EMAIL`, `IMAGE_REGISTRY`, `IMAGE_TAG`, `SEQ_ADMIN_PASSWORD` | prod | Chỉ cho `infra/docker-compose.yml` |

FE (`frontend/.env`, không có bí mật): `VITE_API_TARGET`, `VITE_RT_TARGET` (đích proxy khi dev), `VITE_SENTRY_DSN` (khai báo, chưa dùng).

**Kiểm tra key đúng/sai:** `GET http://localhost:5080/health/ready` thử kết nối Postgres, S3 (list `{KeyPrefix}files/`), SMTP. `/health` chỉ báo còn sống.

## Địa chỉ dev

| URL | |
|---|---|
| :5173 | Web (SPA) |
| :5080/scalar, :5080/openapi/v1.json | Tài liệu API (chỉ Development) |
| :8025 | Mailpit (email đã gửi) |
| :5341 | Seq (log) |

## CI / deploy

- `.github/workflows/ci.yml`: job `backend` (`dotnet build -warnaserror`, `dotnet test --no-build`), job `frontend` (`bun install --frozen-lockfile`, `bun run build`); push `main` → build & đẩy 3 image `api`, `realtime`, `web` lên GHCR. **Chưa có bước deploy SSH** (cần xác nhận khi có VPS).
- Image: `backend/Dockerfile` (`--build-arg SERVICE=OfficeHub.Api|OfficeHub.Realtime`, copy cả `shared/`), `frontend/Dockerfile` (bun build → nginx). Build từ **gốc repo**.
- Production: `infra/docker-compose.yml` (traefik, api, realtime, web, postgres, seq, livekit, backup). Route: `/api` → api, `/rt` → realtime, còn lại → web.
- Backup: container `backup` chạy `infra/backup/backup.sh` mỗi 24h → `s3://$S3__BucketBackup/{KeyPrefix}backup/db|keys/`.
