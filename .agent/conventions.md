# Quy ước code

> Nguồn sự thật là code; feature tham chiếu: BE `backend/src/Modules/Organization`, FE `frontend/src/features/employees`. Về [AGENTS.md](../AGENTS.md).

## Chung

- Ngôn ngữ giao diện, thông báo lỗi, comment: **tiếng Việt**. Tên code: tiếng Anh.
- Trước khi viết helper mới, tìm trong `BuildingBlocks/` (BE) và `src/components/common`, `src/utils`, `src/hooks` (FE).

## Back-end (.NET 10, C#)

- `Directory.Build.props`: `Nullable` + `ImplicitUsings` bật cho mọi project. CI build với `-warnaserror` → **không để warning**.
- **Minimal APIs**, không dùng Controller. **Không dùng MediatR / AutoMapper / MassTransit** (license thương mại); map DTO bằng tay.
- Kết quả endpoint dùng `TypedResults` + `Results<...>` để OpenAPI sinh đúng kiểu.

### Cấu trúc một module (mẫu: Organization)

```
src/Modules/<M>/
├── OfficeHub.Modules.<M>/
│   ├── Domain/            # entity, enum, quy tắc thuần (vd Attendance/Domain/TimesheetCalculator.cs)
│   ├── Features/<Nhóm>/   # <Nhóm>Endpoints.cs (static class, hàm Map(RouteGroupBuilder)), DTO record
│   ├── Infrastructure/    # <X>DbContext + DesignTimeFactory, Migrations/, service, seeder/migrator (IHostedService)
│   └── <M>Module.cs       # : IModule — Name (tiền tố route), Register(), MapEndpoints()
└── OfficeHub.Modules.<M>.Contracts/   # CHỈ khi module khác cần dùng: interface + record công khai
```

- Đăng ký module: thêm `new <M>Module()` vào mảng `modules` trong `src/OfficeHub.Api/Program.cs`.
- **Ranh giới**: module KHÔNG tham chiếu project của module khác, chỉ được tham chiếu `*.Contracts` (test `tests/OfficeHub.Architecture.Tests/ModuleBoundaryTests.cs` sẽ fail). Ví dụ: Organization dùng `IAccountService` (Identity.Contracts); Attendance dùng `IEmployeeDirectory` (Organization.Contracts). `OfficeHub.Realtime` không tham chiếu module nghiệp vụ.
- Tên module hợp đồng lao động là `LaborContracts` (không đặt `Contracts` vì đụng quy ước hậu tố `.Contracts`).
- Đơn cần duyệt: lưu bản ghi `Pending` → `IApprovalService.SubmitAsync` → lưu `ApprovalRequestId` (lỗi thì xoá bản ghi); kết quả nhận qua `IApprovalHandler` **idempotent** ([business/approval.md](business/approval.md)). Mẫu: `Leave/Features/LeaveEndpoints.cs`, `Attendance/Features/Corrections/`.
- Ghi `DateTimeOffset` xuống Postgres luôn ở **UTC** (`.ToUniversalTime()`); Npgsql từ chối offset khác 0. Cột thời điểm = `timestamptz`; `date` / `time` chỉ cho ngày / giờ đồng hồ theo lịch VN (`WorkDate`, giờ ca).
- Entity HR sửa tay (hồ sơ, cấu hình, hợp đồng…) gắn `[Audited]` để có lịch sử sửa; trường bí mật đặt tên `…Encrypted` / `…Hash` hoặc `[AuditMask]` ([business/audit.md](business/audit.md)).
- Lấy giờ hiện tại **chỉ** qua `TimeProvider` (inject, `clock.GetUtcNow()`; đã đăng ký ở mọi host). Cấm `DateTime.Now/UtcNow/Today`, `DateTimeOffset.Now/UtcNow` — `TimeSourceTests` (Architecture.Tests) quét `backend/src` và fail nếu vi phạm. Ngày "hôm nay" theo VN: `AttendanceService.Today` / quy đổi bằng `Office__TimeZone`.
- DTO: `public sealed record` đặt cạnh endpoint. Ngày dùng `DateOnly`, giờ trong ngày `TimeOnly` (API trả chuỗi `"HH:mm"`), thời điểm `DateTimeOffset` (UTC).
- **Thời điểm trong API = ISO 8601 kèm múi giờ** (`BuildingBlocks/Http/Instants.cs`, đăng ký ở `AddOfficeHubDefaults` cho mọi host): BE luôn trả UTC `2026-11-06T02:14:39Z`; JSON nhận vào thiếu `Z`/`±HH:mm` → 400 (không đoán theo giờ máy chủ). Query string không qua converter → nhận `string` rồi `Instants.TryParse` (mẫu: `before` ở `AiRequestEndpoints`). SignalR / MessagePack: gửi chuỗi `Instants.Format(...)`. Ngày `yyyy-MM-dd` và giờ `HH:mm` là lịch / giờ tại văn phòng, không kèm múi giờ. Test: `InstantContractTests`.

### Phân trang danh sách

- Endpoint danh sách nhận `?page=&pageSize=` (page 1-based; pageSize mặc định 20, kẹp 1–200): **có `page`** → `PagedResult<T> { items, total, page, pageSize }`; **không có** → mảng như cũ (MCP tools, script seed / e2e, chọn nhân viên trong form vẫn đọc mảng). Kiểu trả `Results<Ok<List<T>>, Ok<PagedResult<T>>>`.
- Helper `BuildingBlocks/Http/Paging.cs`: `query.ToPagedAsync(page, pageSize, ct)` (COUNT + OFFSET/LIMIT; ORDER BY phải ổn định, thêm `ThenBy` khoá), `Paging.Of(list, …)` khi phải có cả danh sách trong bộ nhớ, `.Map(...)` / `.With(items)` để đổi entity → DTO. Test: `PagingTests`.
- Danh sách tính toán theo người (bảng công, số dư phép, tiền phép, hồ sơ thuế): cắt trang **danh sách nhân viên** (theo mã) trước, rồi chỉ tính / giải mã cho trang đó. Số liệu toàn cục (tổng tháng, đếm theo trạng thái…) → record kế thừa `PagedResult<T>` (mẫu: `BoardPage`, `OvertimePayPage`, `LeavePayoutPage`).
- Lọc / tìm theo tên nhân viên ở module khác: lấy id qua `IEmployeeDirectory` rồi `ids.Contains(...)` trong truy vấn (không JOIN chéo schema) — mẫu `ContractEndpoints.ListAsync`.
- FE: `usePageState(tableId, resetKey)` (`components/common/pagination`; nhớ số dòng / trang ở localStorage `officehub.pageSize.<tableId>`, đổi `resetKey` = về trang 1) → hook `use…Page(…, pg.query)` (`placeholderData: (prev) => prev`) → API `…Page` dùng `pageQs(q)` (`services/api-client.ts`), kiểu `IPaged<T>` (`types/api.ts`) → `<TablePagination state={pg} total={data?.total} unit="…" />` ngay dưới `<Table>`. Không cắt trang ở FE. Query key trang đặt dưới key gốc của feature (vd `['leave', 'my', 'page', q]`) để `invalidateQueries(all)` vẫn làm mới.

### Validation & lỗi

- Lỗi theo field: `OfficeHub.BuildingBlocks.Http.Validation` → `v.Required(...)/.MaxLength/.Email/.When/.Add` rồi `v.Problem()` (400 `ValidationProblem`, key camelCase khớp tên field FE).
- Lỗi nghiệp vụ: `Problems.Conflict(msg)` (409), `Problems.NotFound(what)` (404), hoặc `TypedResults.Problem(msg, statusCode: ...)`. Mọi lỗi theo chuẩn **ProblemDetails**; `detail` là câu tiếng Việt người dùng thấy.
- Không có FluentValidation.

### Phân quyền

- Nhóm endpoint gọi `.RequireAuthorization()`; endpoint ghi thêm `.RequireAuthorization(AuthPolicies.Hr)` (admin|hr) hoặc `AuthPolicies.Manager` (admin|hr|manager) — `BuildingBlocks/Auth/AuthPolicies.cs`.
- Lấy user: `user.GetUserId()`, `user.IsHr()`. Vai trò: `Roles.Admin/Hr/Manager/Employee` (`BuildingBlocks/Auth/AuthCookie.cs`).

### Cấu hình

- Settings class trong `BuildingBlocks/Configuration/Settings.cs` (DataAnnotations, `ErrorMessage = "Thiếu X__Y trong .env"`) + `AddValidatedOptions<T>(config, Section)` (ValidateOnStart). Thêm biến mới → cập nhật `.env.example` và [commands.md](commands.md).
- Dữ liệu cá nhân nhạy cảm (lương…) lưu qua `IFieldEncryptor` (`BuildingBlocks/Security`, `services.AddFieldEncryption(config)`, cột `…Encrypted`) — không tìm / sắp xếp được trên cột mã hoá.

## Front-end

Quy ước FE (cây thư mục, feature, shadcn/ui, theme, layout): xem [frontend.md](frontend.md).

## Code cũ / không bắt chước

- `features/office/engine/OfficeScene.ts` là engine tối giản tạm (capsule + mặt sàn), chưa phải chuẩn cho đồ hoạ.
- `components/feedback/ComingSoon` chỉ dùng cho màn hình chưa làm (leave, approvals, contracts, reports).
- **Tìm kiếm `ILIKE`**: luôn dùng `Like.Contains(term)` (`BuildingBlocks/Http/Like.cs`, TEST-22) để thoát `% _ \` trong từ khoá người dùng — không ghép `$"%{term}%"`.
