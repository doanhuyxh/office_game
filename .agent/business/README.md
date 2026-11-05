# Nghiệp vụ — mục lục

> Nguồn sự thật là code (`backend/src/Modules/*`, `backend/src/OfficeHub.Realtime`, `frontend/src/features/*`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [AGENTS.md](../../AGENTS.md).

OfficeHub là công cụ nội bộ của **một công ty** (~12 nhân sự, 1 văn phòng): văn phòng ảo 3D + quản lý nhân sự. Single-tenant, không có `tenant_id`.

## Khi sửa… đọc…

| Khi sửa | Đọc |
|---|---|
| Đăng nhập, cookie, mật khẩu, quên mật khẩu, link mời, admin seed, `IAccountService` | [auth.md](auth.md) |
| Hồ sơ nhân viên, phòng ban, chức vụ, cấp / mời tài khoản, vai trò, nghỉ việc, `IEmployeeDirectory` | [organization.md](organization.md) |
| Nút chấm công, cách tính đi muộn / thiếu giờ, ca, lịch tuần, ngày lễ, bảng công, báo cáo | [attendance.md](attendance.md) |
| Văn phòng 3D, SignalR hub, bản đồ `shared/office-map.json`, chat, voice token, chấm công trong 3D | [office.md](office.md) |
| Leave, LaborContracts, Approval, Notification, Reporting, Audit | Chưa có nghiệp vụ — chỉ `GET /api/<route>/_status`. FE: `ComingSoon`. Thiết kế dự kiến: `docs/ARCHITECTURE_V2.md` |

## Nguyên tắc chung

- **Vai trò** (`Roles`): `admin`, `hr`, `manager`, `employee`. Policy: `AuthPolicies.Hr` = admin|hr (mọi thao tác ghi dữ liệu nhân sự, ca, lịch), `AuthPolicies.Manager` = admin|hr|manager (xem bảng công người khác). Manager chỉ thấy **bản thân + cấp dưới** (theo `ManagerId`, cả gián tiếp, qua `GetSubordinateIdsAsync`). Kiểm tra quyền luôn ở back-end; menu / guard FE chỉ để điều hướng.
- **Tài khoản ≠ nhân viên**: `identity.users` (đăng nhập) và `org.employees` (hồ sơ) liên kết bằng `employees.UserId`. Tài khoản không có hồ sơ (admin seed) đăng nhập được nhưng không chấm công.
- **Múi giờ**: mọi tính toán ngày giờ dùng `Office__TimeZone` (`Asia/Ho_Chi_Minh`). DB lưu `DateTimeOffset` UTC; `WorkDate` là ngày địa phương. FE hiển thị qua `utils/date.ts` cùng múi giờ.
- **Giờ do server quyết định** (chấm công). Không tin giờ trình duyệt.
- **Xoá mềm** dữ liệu nhân sự (`DeletedAt` / `Status = Resigned`); sự kiện chấm công không bao giờ sửa.
- **Lỗi** trả ProblemDetails với `detail` tiếng Việt; validate theo field (400) dùng key camelCase. FE hiển thị qua `fieldErrors` / `errorMessage`.
- **Thông báo tiếng Việt** viết trực tiếp trong code back-end (chưa có i18n).

## Điểm cần lưu ý / nợ kỹ thuật đã biết

1. **Mời qua email lỗi SMTP để lại tài khoản mồ côi**: `AccountService.InviteAsync` tạo user rồi mới gửi mail; mail lỗi → `AccountEndpoints` trả 502 **trước khi** ghi `employee.UserId`. Hồ sơ không liên kết tài khoản, "Gửi lại lời mời" không khả dụng, tạo lại báo `"Tên đăng nhập '…' đã tồn tại"`.
2. **Khoá tài khoản chưa có hiệu lực tức thì**: OfficeHub.Realtime dùng `AddCookie` thường (không kiểm tra security stamp) → người bị khoá / nghỉ việc vẫn vào văn phòng 3D tới khi cookie hết hạn (7 ngày trượt). Ở Api, cookie được kiểm tra lại theo chu kỳ mặc định của ASP.NET Identity (cần xác nhận: 30 phút); chỉ `/api/auth/me` và `/api/attendance/check` tự kiểm tra `IsActive`.
3. Không có transaction trải nhiều module (xem [database.md](../database.md#không-có)).
4. 2FA: `LoginAsync` có nhánh `RequiresTwoFactor` nhưng chưa có API bật 2FA.
5. Không có chống CSRF (antiforgery); đang dựa vào `SameSite=Lax` + body JSON (cần xác nhận khi lên production).
6. Khai báo nhưng chưa dùng: `Office__InactiveMinutes`, `IFileStorage` (chưa module nào upload), FE `ENV`, `STORAGE_KEY`, `REALTIME.voiceToken`, `VITE_SENTRY_DSN`, thư mục `src/context/`, `src/assets/icons|images` trống.
7. `frontend/package.json` có dependency `cn` (^0.5.2) **không được import** — do `shadcn add` sinh nhầm `from "cn"`; có thể gỡ.
8. Dev chạy qua Vite proxy → IP là localhost → chấm công luôn `Remote` trừ khi `Office__IpRanges` chứa `127.0.0.1/32`.
9. Bảng công tính lại mỗi lần đọc (đủ nhanh cho ~12 người). Chưa có "chốt công", tăng ca, giờ lõi ca linh hoạt, ca qua đêm, giải trình.
10. `reactivate` không khôi phục `ManagerId` / `HeadEmployeeId` đã bị gỡ khi nghỉ việc. `departments.HeadEmployeeId` không có FK.
11. Văn phòng 3D là bản tối giản (sàn, vùng, avatar capsule); code game MVP cũ đã được xoá có chủ ý, engine đầy đủ sẽ viết mới trong `features/office/engine`.
12. FE không có lint và test tự động; BE chỉ có test kiến trúc + test `TimesheetCalculator`.
13. DB dev là Postgres dùng chung của công ty; admin seed đang dùng giá trị mẫu của `.env.example` (đã biết, chủ dự án chấp nhận khi dev).
