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
- Ghi `DateTimeOffset` xuống Postgres luôn ở **UTC** (`.ToUniversalTime()`); Npgsql từ chối offset khác 0.
- DTO: `public sealed record` đặt cạnh endpoint. Ngày dùng `DateOnly`, giờ trong ngày `TimeOnly` (API trả chuỗi `"HH:mm"`), thời điểm `DateTimeOffset` (UTC).

### Validation & lỗi

- Lỗi theo field: `OfficeHub.BuildingBlocks.Http.Validation` → `v.Required(...)/.MaxLength/.Email/.When/.Add` rồi `v.Problem()` (400 `ValidationProblem`, key camelCase khớp tên field FE).
- Lỗi nghiệp vụ: `Problems.Conflict(msg)` (409), `Problems.NotFound(what)` (404), hoặc `TypedResults.Problem(msg, statusCode: ...)`. Mọi lỗi theo chuẩn **ProblemDetails**; `detail` là câu tiếng Việt người dùng thấy.
- Không có FluentValidation.

### Phân quyền

- Nhóm endpoint gọi `.RequireAuthorization()`; endpoint ghi thêm `.RequireAuthorization(AuthPolicies.Hr)` (admin|hr) hoặc `AuthPolicies.Manager` (admin|hr|manager) — `BuildingBlocks/Auth/AuthPolicies.cs`.
- Lấy user: `user.GetUserId()`, `user.IsHr()`. Vai trò: `Roles.Admin/Hr/Manager/Employee` (`BuildingBlocks/Auth/AuthCookie.cs`).

### Cấu hình

- Settings class trong `BuildingBlocks/Configuration/Settings.cs` (DataAnnotations, `ErrorMessage = "Thiếu X__Y trong .env"`) + `AddValidatedOptions<T>(config, Section)` (ValidateOnStart). Thêm biến mới → cập nhật `.env.example` và [commands.md](commands.md).

## Front-end (React 19 + Vite + TS, bun)

### Cây thư mục `frontend/src`

```
assets/styles/global.css      # Tailwind v4 + biến màu theme shadcn
components/common/            # shadcn (tên file thường: button.tsx, dialog.tsx…) + FormField, SelectField
components/feedback/          # Spinner, ComingSoon
components/layout/            # MainLayout, navigation.ts
config/                       # env.ts, paths.ts (PATHS), roles.ts (ROLE), theme.ts
features/<x>/                 # mỗi màn hình / nghiệp vụ một feature
hooks/                        # hook dùng chung (useDebounce)
routes/                       # router.tsx, guards.ts
services/api-client.ts        # http(), httpPost(), ApiError
types/                        # api.ts (ProblemDetails), generated/ (Orval)
utils/                        # cn.ts, date.ts, errors.ts
```

### Cấu trúc một feature (mẫu: `features/employees`)

```
features/employees/
├── api/org.api.ts          # hàm gọi API + query key (orgKeys)
├── hooks/useOrg.ts         # useQuery / useMutation; mutation invalidate theo key gốc
├── types/employee.types.ts # interface I* khớp DTO back-end
├── utils/labels.ts         # nhãn tiếng Việt, hằng số riêng feature
├── components/             # EmployeesPage (màn hình) + component con
└── index.ts                # public API (barrel)
```

- Ngoài feature **chỉ import qua `@/features/<x>`** (barrel). Trong feature dùng đường dẫn tương đối. Feature được có thêm thư mục riêng (vd `office/engine`, `office/store`).
- Màn hình mới: tạo feature → thêm `page(PATHS.x, () => import('@/features/x'), '<Export>')` trong `routes/router.tsx` → thêm `PATHS.x` vào `config/paths.ts` → thêm menu vào `components/layout/navigation.ts`. **Không** tạo file route bọc lại component (không có thư mục `app/`).
- Interface đặt tên `I<Tên>`; kiểu union string literal cho enum (khớp tên enum C#).
- Gọi API **luôn** qua `http`/`httpPost` (`services/api-client.ts`, `credentials: 'include'`). Không lưu token (đăng nhập bằng cookie HttpOnly).
- Lỗi: `fieldErrors(err)` cho form, `errorMessage(err)` cho toast (`utils/errors.ts`). Toast dùng `toast` từ `sonner`.
- Form: `FormField` / `SelectField` (`components/common`). `SelectField` dùng giá trị đặc biệt cho "không chọn" (Radix không nhận value rỗng) và trả `null`.
- Ngày giờ hiển thị: `formatDate`, `formatTime`, `formatMinutes` (`utils/date.ts`, múi giờ `Asia/Ho_Chi_Minh`).
- State: TanStack Query cho dữ liệu server; Zustand chỉ cho văn phòng 3D (`features/office/store`). Không dùng Redux.
- Style: Tailwind class; ghép class bằng `cn()` (`utils/cn.ts`). CSS thuần chỉ ở văn phòng 3D (`office.css`, mọi selector bọc trong `.office-root`).
- `shadcn add` có thể sinh import `from "cn"` sai → sửa thành `@/utils/cn`; `sonner.tsx` đã bỏ `next-themes`.

## Code cũ / không bắt chước

- `features/office/engine/OfficeScene.ts` là engine tối giản tạm (capsule + mặt sàn), chưa phải chuẩn cho đồ hoạ.
- `components/feedback/ComingSoon` chỉ dùng cho màn hình chưa làm (leave, approvals, contracts, reports).
