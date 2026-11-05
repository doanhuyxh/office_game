> ⚠️ **Bản mới, có breaking change**: .NET 10, TypeScript **7** (bỏ `baseUrl`), Vite **8** (Rolldown), Tailwind **4**, React 19. Không chắc thì đọc `frontend/node_modules/<gói>/`; TanStack Router: `frontend/node_modules/@tanstack/react-router/skills/*/SKILL.md`.

# OfficeHub

Văn phòng ảo 3D + quản lý nhân sự nội bộ cho một công ty (giao diện tiếng Việt, múi giờ `Asia/Ho_Chi_Minh`). Back-end ASP.NET Core (.NET 10, PostgreSQL, SignalR), front-end React 19 + Vite + TanStack + Three.js; package manager FE là **bun**.

File này chỉ là bộ định tuyến. Tài liệu thật nằm trong `.agent/` — đọc file tương ứng trước khi làm việc.

| Khi bạn cần... | Đọc |
|---|---|
| Chạy dev, build, test, migration, biến `.env`, CI, deploy | [.agent/commands.md](.agent/commands.md) |
| Viết code đúng chuẩn: module BE, feature FE, validation, đặt tên | [.agent/conventions.md](.agent/conventions.md) |
| Luồng request, cookie Api ↔ Realtime, route/trang, cache | [.agent/architecture.md](.agent/architecture.md) |
| Thêm/sửa bảng, index, migration, quy tắc ghi dữ liệu | [.agent/database.md](.agent/database.md) |
| Nguyên tắc phân quyền, nợ kỹ thuật đã biết | [.agent/business/README.md](.agent/business/README.md) |
| Sửa đăng nhập, mật khẩu, link mời, quên mật khẩu, admin seed | [.agent/business/auth.md](.agent/business/auth.md) |
| Sửa nhân viên, phòng ban, chức vụ, cấp tài khoản, vai trò, nghỉ việc | [.agent/business/organization.md](.agent/business/organization.md) |
| Sửa chấm công, ca, lịch tuần, ngày lễ, cách tính muộn / thiếu giờ, bảng công | [.agent/business/attendance.md](.agent/business/attendance.md) |
| Sửa văn phòng 3D, SignalR hub, bản đồ, chat, voice, chấm công trong 3D | [.agent/business/office.md](.agent/business/office.md) |

## Luật không được vi phạm

1. **Kiểm tra quyền ở back-end** (`AuthPolicies.Hr` / `AuthPolicies.Manager`); manager chỉ thấy bản thân + cấp dưới (`GetSubordinateIdsAsync`). Guard/menu FE không phải lớp bảo mật.
2. **Ranh giới module**: module BE không tham chiếu project module khác — chỉ `OfficeHub.Modules.<X>.Contracts`; không JOIN / FK chéo schema. `dotnet test` (ModuleBoundaryTests) sẽ fail nếu vi phạm.
3. **Business logic đặt ở back-end** (endpoint/service/`Domain` của module). FE chỉ hiển thị, gọi API qua `services/api-client.ts`.
4. **`attendance.events` chỉ thêm, không sửa/xoá**; bảng công luôn tính từ sự kiện qua `TimesheetCalculator`. Đổi quy tắc tính → sửa cả `tests/OfficeHub.Modules.Attendance.Tests`.
5. **Thời gian do server quyết định** (`TimeProvider` + `Office__TimeZone`); lưu `DateTimeOffset` UTC.
6. **Không commit secret**: mọi cấu hình qua `.env` (đã gitignore). Thêm biến → khai báo Settings có `ErrorMessage = "Thiếu X__Y trong .env"`, cập nhật `.env.example` và `commands.md`.
7. **FE**: ngoài feature chỉ import qua `@/features/<x>`; màn hình mới = feature + một dòng `page(...)` trong `routes/router.tsx` (không tạo file route bọc component). Dùng component/helper sẵn có (`components/common`, `utils`, `BuildingBlocks`) trước khi tạo mới. Chỉ dùng bun.
8. **Xong việc phải pass**: `backend/`: `dotnet build -warnaserror` và `dotnet test`; `frontend/`: `bun run build`.

## Giữ tài liệu đúng

- `.agent/` là nguồn sự thật duy nhất cho agent (`docs/ARCHITECTURE_V2.md` là kế hoạch, có phần chưa làm).
- Đổi business rule → sửa file trong `.agent/business/`; đổi schema → `database.md`; thêm lệnh/script/env → `commands.md`; đổi cấu trúc/luồng dữ liệu → `architecture.md`.
- Mỗi file ≤ ~8 KB, chỉ đọc file cần cho task; vượt thì tách theo domain con, thêm dòng vào bảng định tuyến (ở đây và `business/README.md`).
- Nếu tài liệu khác code, tin code và sửa tài liệu trong cùng commit.
