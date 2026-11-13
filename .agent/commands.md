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
dotnet run --project src/OfficeHub.Mcp        # http://localhost:5100/mcp (tuỳ chọn: máy chủ MCP cho trợ lý AI)

# 3) Front-end (từ frontend/)
bun install
bun run dev                                   # http://localhost:5173, proxy /api → 5080, /rt → 5090 (ws), /mcp + /.well-known/oauth-* → 5100
```

`EnvLoader.Load()` tìm `.env` ngược từ thư mục hiện tại → chạy `dotnet` ở đâu trong repo cũng đọc được `.env` gốc.

## Build / test / kiểm tra

| Việc | Lệnh | Thư mục |
|---|---|---|
| Build BE (như CI) | `dotnet build -warnaserror` | `backend/` |
| Test BE | `dotnet test` (mọi project `tests/*`: Architecture, từng module, Mcp, Realtime) | `backend/` |
| Typecheck FE | `bun run typecheck` (`tsc -b`) | `frontend/` |
| Build FE | `bun run build` (`tsc -b && vite build`) | `frontend/` |
| Sinh type từ OpenAPI | `bun run api:generate` (Orval → `src/types/generated/`, thư mục **chưa tồn tại** tới khi chạy lần đầu; cần Api đang chạy) | `frontend/` |
| Sửa bản đồ văn phòng 3D | sửa `shared/office-map.json` → `bun design/tools/render-plan.ts` (vẽ `design/floor-plan.svg`, ghi `shared/office-map.grid.txt`, kiểm tra; lỗi → exit 1) | gốc repo |
| Tạo lại tài khoản / hợp đồng thử, e2e văn phòng 3D | `TEST_PASSWORD=… [BASE_URL=http://localhost:5173] bun scripts/dev/<seed-org|seed-contracts|office-e2e|voice-e2e>.ts` (xem [progress.md](progress.md)) | gốc repo |
| Icon PWA · nhập model GLB văn phòng 3D | `bun scripts/dev/make-icons.ts` · `bun scripts/dev/import-furniture.ts <kenney.zip\|thư-mục>` (ghi `frontend/public/models/furniture/` + manifest) · nhân vật: `bun scripts/dev/import-characters.ts <dir có men/ women/ .gltf>` (ghi `public/models/characters/` + `shared/avatar-catalog.json`) | gốc repo |
| E2E khác (MCP, OAuth, chat phòng, lương / ký, bot trong 3D: `bot-*-e2e.ts`…) | xem [e2e.md](e2e.md) | gốc repo |
| Thêm / cập nhật component shadcn | `bun run ui:add <tên…> [--overwrite]` → vào `src/components/common/` (**không** gọi `bunx shadcn add` trực tiếp) | `frontend/` |

FE **không có lint/test runner** (không có ESLint, Vitest). Kiểm tra = `bun run build`.

## Migration EF Core

Mỗi module một DbContext/schema. Tool cục bộ `dotnet-ef` (`backend/dotnet-tools.json`). Từ `backend/`:

```bash
dotnet ef migrations add <TenMigration> \
  --project src/Modules/<M>/OfficeHub.Modules.<M> \
  --startup-project src/OfficeHub.Api \
  --context <DbContext> -o Infrastructure/Migrations
```

DbContext hiện có: `OfficeIdentityDbContext`, `OrgDbContext`, `AttendanceDbContext`, `ApprovalDbContext`, `LeaveDbContext`, `NotificationDbContext`, `ContractsDbContext`, `DocumentsDbContext`, `AssetsDbContext`, `ChatDbContext` (… và các module khác). Migration tự chạy khi Api khởi động nếu `Database__MigrateOnStartup=true`. Chi tiết: [database.md](database.md).

## Bộ điều phối agent (`agent-runner/`)

`cd agent-runner && bun install && bun run typecheck && bun test` · `bun src/cli.ts doctor --config <agents.yaml>` · build `bun run build`. Chi tiết: [business/agent-runner.md](business/agent-runner.md).

## Biến môi trường

Bảng đầy đủ: [env.md](env.md). S3 (file nghiệp vụ) / SMTP / FCM / IP văn phòng sửa được trên trang Hệ thống → Cấu hình và được ưu tiên hơn `.env`; biến `.env` vẫn là mặc định khi nhóm chưa lưu trong DB ([env.md](env.md#cấu-hình-lưu-trong-db-test-41)). Dev cần `Chat__InternalKey` trong `.env` (Api và Realtime cùng giá trị; `openssl rand -base64 32`). Tuỳ chọn tách theo chiều gọi: `Chat__McpToRealtimeKey`, `Chat__RealtimeToApiKey` ([env.md](env.md)).

## Địa chỉ dev

| URL | |
|---|---|
| :5173 | Web (SPA) |
| :5080/scalar, :5080/openapi/v1.json | Tài liệu API (chỉ Development, không cần đăng nhập — Orval dùng) |
| `/api/system/docs/` (mọi môi trường, qua FE `/system`) | Tài liệu API cho **admin đã đăng nhập** (cả production) |
| :8025 | Mailpit (email đã gửi) |
| :5341 | Seq (log) |

## CI / deploy

- `.github/workflows/ci.yml`: job `backend` (`dotnet build -warnaserror`, `dotnet test --no-build`), job `frontend` (`bun install --frozen-lockfile`, `bun run build`); push `main` → build & đẩy image `backend`, `web` lên GHCR (không bắt buộc — VPS tự build).
- Image: `backend/Dockerfile` = **một** image Alpine cho cả Api + Realtime + Mcp (chọn bằng biến `SERVICE`; container web chuyển `/mcp` → `mcp:8080`, tắt buffer), `frontend/Dockerfile` = FE + nginx. Build từ **gốc repo**.
- Production `infra/docker-compose.yml`: api, realtime, mcp, web, livekit, backup (+ `--profile logs` Seq, `--profile localdb` Postgres). **Một domain, một cổng**: container `web` (`frontend/nginx.conf`) chia `/api` → api, `/rt` → realtime, `/livekit` → `livekit:7880` (mạng Docker; media `7881/tcp` + `7882/udp` publish ra máy), còn lại FE; mở `${HTTP_BIND:-0.0.0.0}:${HTTP_PORT:-7080}`. Nginx (cùng máy hoặc VPS khác) chỉ proxy domain vào đó; IP thật chỉ lấy từ `X-Forwarded-For` khi request đến từ `TRUSTED_PROXY_IPS` (+ 127.0.0.1, 172.16.0.0/12) — `frontend/nginx-realip.sh` sinh `realip.conf` (`infra/nginx/officehub.conf`, gửi `X-Forwarded-For/Proto` + header WebSocket), SSL bằng certbot.
- Deploy trên VPS (repo clone tại `/opt/officehub`, file `.env` copy từ `.env.pro`): `sh scripts/deploy.sh` = `git pull` → build (truyền `GIT_SHA` / `BUILD_TIME` → Hệ thống → Vận hành) → `up -d` → `docker builder prune` + `image prune` (xoá SDK / cache build sau mỗi lần). Log Docker xoay vòng 3 × 10 MB / container.
- **Sau mỗi lần deploy** (từ máy dev, chỉ đọc): `BASE_URL=https://office.lokid.me bun scripts/dev/prod-smoke.ts` — HTTPS + header bảo mật, `/health`, Api, OAuth / MCP discovery, Realtime, LiveKit `/livekit` + 7881/tcp; thêm `SMOKE_USER` / `SMOKE_PASSWORD` (tài khoản thử) để kiểm tra các API đã đăng nhập. 7882/udp: thử voice thật.
- Container `web` (`frontend/nginx.conf` + `nginx-security-headers.conf`): HSTS, `X-Frame-Options: DENY` + `frame-ancestors 'none'` (chống clickjacking trang đồng ý OAuth), nosniff, Referrer-Policy, Permissions-Policy (micro / chia sẻ màn hình chỉ chính trang). **CSP đầy đủ** (TEST-19) đang ở `Content-Security-Policy-Report-Only` → trình duyệt gửi vi phạm về `POST /api/csp-report` (Api ghi log Warning `Csp` → Seq). Vài ngày không có vi phạm thật → đổi tên header sang `Content-Security-Policy` ở **cả hai** file `nginx-security-headers*.conf`; đổi nguồn ngoài (font, S3, Firebase, video nhúng) → sửa chuỗi ở cả hai file rồi chạy `scripts/dev/csp-e2e.ts`. Script inline bị cấm (`script-src 'self'`): theme ở `public/theme-init.js`, trang offline ở `public/offline.js`. Location nào có `add_header` riêng phải `include` lại snippet. Proxy ngoài (`infra/nginx/officehub.conf`): `certbot --nginx --redirect` (80 → 301 https), `server_tokens off`, HSTS (ẩn bản container gửi lên). `/health` (liveness) mở ra ngoài; `/health/ready` không.
- Biến prod: `APP_DOMAIN`, `HTTP_PORT`, `POSTGRES_HOST/PORT/DB/USER/PASSWORD` (compose ghép `ConnectionStrings__Default`), `LiveKit__Url=wss://<APP_DOMAIN>/livekit`, `SEQ_URL` (trống = tắt Seq). Chạy với file env tên khác: `OFFICEHUB_ENV_FILE=../.env.pro docker compose --env-file .env.pro -f infra/docker-compose.yml …` (thiếu `--env-file` → biến trống).
- Mô hình hiện tại của chủ dự án: VPS code **không mở cổng public**, VPS proxy (nginx + SSL) nối sang qua **VPN** → `proxy_pass http://<IP VPN VPS code>:7080`, `stream` chuyển 7881/tcp + 7882/udp sang IP VPN đó; `TRUSTED_PROXY_IPS` = IP VPN của VPS proxy, `LIVEKIT_NODE_IP` = IP public VPS proxy.
- Firewall VPS chạy OfficeHub: mở 7881/tcp + 7882/udp (media voice, LiveKit một cổng UDP; `LIVEKIT_NODE_IP` = IP người dùng tới được 2 cổng này — chuyển tiếp qua VPS proxy thì là IP VPS proxy); cổng 7080 **chỉ cho IP VPS proxy** — Docker bỏ qua `ufw`, dùng firewall nhà cung cấp hoặc chain `DOCKER-USER`. VPS proxy: mở 80, 443.
- Backup: container `backup` chạy `infra/backup/backup.sh` mỗi 24h → `s3://$S3__BucketBackup/{KeyPrefix}backup/db|keys/`.
