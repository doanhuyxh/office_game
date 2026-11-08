# Bẫy đã gặp

> Lỗi / hành vi dễ vấp khi dev OfficeHub. Về [progress.md](progress.md).

- Body JSON sai trước đây ra **500** ở Development (minimal API ném `BadHttpRequestException`); đã cấu hình `ThrowOnBadRequest` + `StatusCodeSelector` + ProblemDetails trong `AddOfficeHubDefaults` → luôn 400 (thông điệp tiếng Việt cho thời điểm thiếu múi giờ).
- Lịch họp thử phải bắt đầu ≥ hiện tại − 5 phút (quy tắc chống đặt lùi).

- SMTP dev là Gmail thật → email tới địa chỉ thật sẽ gửi thật; tên miền dành riêng bị bỏ qua (`EmailPolicy`).
- S3: bucket riêng `officehubdoanhuyxh` + IAM user `OfficeHub` (chỉ quyền trên `officehub/*`), không public. File upload trước khi đổi vẫn ở bucket cũ `finsplit/officehub/` (chưa chuyển).
- Đăng nhập trả **2 `Set-Cookie: officehub.auth`** (cookie stamp cũ rồi cookie stamp mới — xem "Mỗi lúc chỉ 1 thiết bị" ở [business/auth.md](business/auth.md)). Script e2e tự đọc cookie phải lấy **cái cuối** (`.filter(...).at(-1)`, mẫu `finance-e2e.ts`); script cũ dùng `.find(...)` sẽ lấy cookie chết → 401.
- `/api/auth/login` giới hạn **30 lần / phút / IP** (`RateLimits.Auth`) → chạy hai script e2e nối nhau (mỗi script tạo + đăng nhập nhiều tài khoản) dễ bị **429** → cookie rỗng → hàng loạt 401 trông như lỗi đăng nhập. Đợi ≥ 60 s giữa các script.
- `dotnet run` dùng `launchSettings.json` (cổng 5080) và **bỏ qua `ASPNETCORE_URLS`** → chạy Api e2e ở cổng khác cần `--no-launch-profile`.
- Lần migrate đầu của schema mới, EF log `ERR … __ef_migrations` — bình thường.
- `dotnet ef migrations remove` cần DB → với migration đầu của context, xoá tay 3 file (migration, Designer, Snapshot).
- Sửa `shared/office-map.json` → phải chạy `bun design/tools/render-plan.ts` (ghi lại `office-map.grid.txt`), nếu không test Realtime fail.
- Thêm component shadcn: `bun run ui:add` (trả lời `n` khi hỏi ghi đè).
- Job nền (email, nhắc hợp đồng) giả định **một** instance Api.
- Api dev chạy lâu không khởi động lại → FE mới gọi route chưa có → 404 / "Cấp undefined". Sau khi đổi BE: khởi động lại Api (`dotnet run --project src/OfficeHub.Api --launch-profile http`). Migration có thể đã được bản khác dùng chung DB (production?) chạy trước.
- Đừng bọc component lazy của route trong component khác (React lỗi `use()`); chặn theo vai trò dùng `beforeLoad` + `notFound({ data: { forbidden: true } })`.
- Pipeline xác thực đặt `Cache-Control: no-store` cho mọi response API → không cache được ảnh đại diện qua endpoint chuyển hướng (chấp nhận).
- Thời hạn token AI chỉ nhận 30 / 90 / 180 / 365 ngày (script test từng dùng 7 → tạo token thất bại âm thầm).
- `AddHttpClient` mặc định có **cookie jar dùng chung** (handler trong pool): gọi Api thay mặt người dùng bằng header `Cookie` tự đặt thì phải `ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseCookies = false })`, nếu không cookie gia hạn của người A bị gửi kèm request của người B (Realtime từng kiểm tra phiên / đọc nhân vật nhầm người — sửa 2026-11-06).
- Voice báo "Không kết nối được máy chủ voice" mà token vẫn 200 → lỗi ICE: LiveKit trong Docker báo IP container. Dev compose đã có `--node-ip ${LIVEKIT_NODE_IP:-127.0.0.1}`; đổi xong phải `up -d livekit` để tạo lại container.
