# Tiến độ & bàn giao phiên

> Cập nhật **2026-11-06**: đã deploy production `https://office.lokid.me` (commit `ab8fac0`); smoke test + header bảo mật nginx. Đọc file này đầu phiên mới. Chi tiết nghiệp vụ: bảng định tuyến trong [AGENTS.md](../AGENTS.md); kế hoạch tổng: `docs/ARCHITECTURE_V2.md` (§0 trạng thái, §11 quyết định đã chốt, §12 lộ trình).

## Đã xong

| Hạng mục | Tài liệu (`business/`) |
|---|---|
| Identity, Organization, chấm công + giải trình + tăng ca, phê duyệt, nghỉ phép, thông báo, hợp đồng (+ mẫu Word) | `auth`, `organization`, `attendance*`, `approval`, `leave`, `notifications`, `contracts` |
| Báo cáo + Excel, quy ra tiền tăng ca / phép (khi nghỉ việc) · đặt phòng họp (+ "Đang họp" trong 3D) | `reports`, `meetings` |
| Nhắc quên chấm ra (chuông) · nhập nhân viên từ Excel · lịch sử sửa dữ liệu nhân sự (`[Audited]`, che lương) | `attendance-corrections`, `employee-import`, `audit` |
| Văn phòng 3D giai đoạn 1 (bản đồ v2, engine low-poly, A*, ngồi, minimap) + voice LiveKit (khoảng cách, phòng riêng, chia sẻ màn hình) | `office`, `office-engine`, `design/` |
| Kết nối AI: MCP 34 tool (không hợp đồng / lương, chấm công AI = Remote), token cá nhân + OAuth 2.1, nhật ký AI, HR thu hồi | `mcp`, `mcp-oauth` |
| Giao diện shadcn-admin (sidebar, ⌘K, sáng / tối) | `../frontend.md` |

Kiểm tra cuối: build ✔, `dotnet test` 223 test ✔, `bun run build` ✔, e2e: văn phòng 3D 16/16, voice 30/30, MCP 33/33, OAuth 30/30, giai đoạn 2 28/28, nhắc / Excel / lịch sử 18/18 (DB tạm). Production `prod-smoke.ts`: 13/17 trước khi deploy lại header bảo mật + `/health`.

## Quyết định đã chốt gần đây (đừng hỏi / đề xuất lại)

- Văn phòng 3D: mặt bằng + giả định đã duyệt (camera chéo low-poly, laptop trước, voice ở giai đoạn 3). **Giai đoạn 2 bị bỏ**: không làm gán chỗ ngồi, trạng thái (chấm công / nghỉ phép / vắng) trên avatar, "tìm đồng nghiệp", người offline hiện mờ.
- Hợp đồng: HR quản lý tất cả, nhân viên xem của mình, quản lý **không** xem của cấp dưới; lương mã hoá; nhắc HR + quản lý trực tiếp.
- Thông báo: email + chuông. Tăng ca / nghỉ phép: xem §11 `ARCHITECTURE_V2.md`.

## Việc tiếp theo

1. **Chủ dự án deploy lại** (nginx: header bảo mật + `/health`) rồi chạy `prod-smoke.ts` → mong đợi 17/17. Thử thật trên production: voice giữa 2 mạng khác nhau (7882/udp), kết nối claude.ai / Copilot qua OAuth, email nhắc.
2. Chưa chọn (hỏi trước khi làm): chat theo phòng, model GLB, mobile; giai đoạn 3 (webhook máy chấm công, PWA, ký điện tử, tính lương); HR bật / tắt AI theo người.

## Chạy & dữ liệu dev

- Lệnh: [commands.md](commands.md). Dev chạy 3 tiến trình: Api :5080, Realtime :5090, FE :5173 (Vite proxy). Postgres / S3 / SMTP trong `.env` là **dịch vụ thật** (DB công ty ở xa → mỗi API ~1 s).
- **`Encryption__Key`** đã được tạo trong `.env` (lương hợp đồng mã hoá bằng khoá này) — mất khoá = mất lương đã lưu; nhắc chủ dự án sao lưu.
- **Tài khoản thử**: `account.txt` ở gốc repo (gitignore) — 12 nhân viên NV010–NV021 trong 6 phòng ban, email `@officehub.test`, mật khẩu chung ghi trong file. Dùng lại để test, **không** tạo rồi xoá tài khoản. Mỗi người có hợp đồng mẫu (2 cái sắp hết hạn để thử nhắc). **NV001, NV009 (chủ dự án) là dữ liệu thật — không sửa.** Admin seed: `Seed__*` trong `.env` (không có hồ sơ nhân viên).
- Dọn dữ liệu do test tạo (đơn, thông báo…): không có `psql` cục bộ → `docker run --rm --env-file <pg.env> postgres:18-alpine psql …` với thông tin từ `ConnectionStrings__Default`.

## Công cụ test (`scripts/dev/`, chạy từ gốc repo, `TEST_PASSWORD` = mật khẩu trong `account.txt`)

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

## Test trên DB tạm (khi test tạo dữ liệu không xoá được, vd nhân viên)

`docker run -d --name officehub-e2e-pg -e POSTGRES_DB=officehub_e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=<tuỳ ý> -p 127.0.0.1:55432:5432 postgres:18-alpine` → chạy Api với `ConnectionStrings__Default=Host=127.0.0.1;Port=55432;…` (tự migrate + tạo admin từ `Seed__*`) → test → `docker rm -f officehub-e2e-pg`. S3 / SMTP vẫn là dịch vụ thật trong `.env`.

## Bẫy đã gặp

- Body JSON sai trước đây ra **500** ở Development (minimal API ném `BadHttpRequestException`); đã cấu hình `ThrowOnBadRequest` + `StatusCodeSelector` + ProblemDetails trong `AddOfficeHubDefaults` → luôn 400 (thông điệp tiếng Việt cho thời điểm thiếu múi giờ).
- Lịch họp thử phải bắt đầu ≥ hiện tại − 5 phút (quy tắc chống đặt lùi).

- SMTP dev là Gmail thật → email tới địa chỉ thật sẽ gửi thật; tên miền dành riêng bị bỏ qua (`EmailPolicy`).
- S3: bucket riêng `officehubdoanhuyxh` + IAM user `OfficeHub` (chỉ quyền trên `officehub/*`), không public. File upload trước khi đổi vẫn ở bucket cũ `finsplit/officehub/` (chưa chuyển).
- Lần migrate đầu của schema mới, EF log `ERR … __ef_migrations` — bình thường.
- `dotnet ef migrations remove` cần DB → với migration đầu của context, xoá tay 3 file (migration, Designer, Snapshot).
- Sửa `shared/office-map.json` → phải chạy `bun design/tools/render-plan.ts` (ghi lại `office-map.grid.txt`), nếu không test Realtime fail.
- Thêm component shadcn: `bun run ui:add` (trả lời `n` khi hỏi ghi đè).
- Job nền (email, nhắc hợp đồng) giả định **một** instance Api.
- Voice báo "Không kết nối được máy chủ voice" mà token vẫn 200 → lỗi ICE: LiveKit trong Docker báo IP container. Dev compose đã có `--node-ip ${LIVEKIT_NODE_IP:-127.0.0.1}`; đổi xong phải `up -d livekit` để tạo lại container.
