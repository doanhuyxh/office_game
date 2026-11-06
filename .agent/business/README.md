# Nghiệp vụ — mục lục

> Nguồn sự thật là code (`backend/src/Modules/*`, `backend/src/OfficeHub.Realtime`, `frontend/src/features/*`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [AGENTS.md](../../AGENTS.md).

OfficeHub là công cụ nội bộ của **một công ty** (~12 nhân sự, 1 văn phòng): văn phòng ảo 3D + quản lý nhân sự. Single-tenant, không có `tenant_id`.

## Khi sửa… đọc…

| Khi sửa | Đọc |
|---|---|
| Đăng nhập, cookie, mật khẩu, quên mật khẩu, link mời, admin seed, `IAccountService` (+ `ListByRoleAsync`) | [auth.md](auth.md) |
| Hồ sơ nhân viên, phòng ban, chức vụ, cấp / mời tài khoản, vai trò, nghỉ việc, `IEmployeeDirectory` | [organization.md](organization.md) |
| Nút chấm công, cách tính đi muộn / thiếu giờ, ca, lịch tuần, ngày lễ, bảng công, báo cáo | [attendance.md](attendance.md) |
| Văn phòng 3D, SignalR hub, bản đồ `shared/office-map.json`, chat, voice token, chấm công trong 3D | [office.md](office.md) |
| Engine 3D (Three.js): camera, đi / tìm đường, ngồi, minimap, đồ đạc, avatar | [office-engine.md](office-engine.md) |
| Luồng duyệt (quản lý → HR), không tự duyệt, `IApprovalHandler`, thêm loại đơn | [approval.md](approval.md) |
| Loại phép, quỹ phép năm (cộng dồn, không hết hạn), đơn nghỉ, điều chỉnh của HR | [leave.md](leave.md) |
| Giải trình chấm công (bổ sung giờ vào / ra), nhắc quên chấm ra | [attendance-corrections.md](attendance-corrections.md) |
| Tăng ca (đơn, hệ số theo loại ngày, giới hạn) | [attendance-overtime.md](attendance-overtime.md) |
| Thông báo: chuông in-app + email (hàng đợi, thử lại), ai nhận gì khi gửi / duyệt / từ chối / huỷ đơn, `INotifier` | [notifications.md](notifications.md) |
| Hợp đồng lao động: loại / thời hạn theo BLLĐ, phụ lục, lương mã hoá, file S3, nhắc 30 / 7 ngày, quyền xem, mẫu hợp đồng Word | [contracts.md](contracts.md) |
| Kết nối AI (MCP): token truy cập cá nhân, route token được gọi, tool cho Claude / Cursor / Codex | [mcp.md](mcp.md) |
| Kết nối AI: OAuth 2.1 (DCR, PKCE, refresh), nhật ký AI (Audit), HR thu hồi, giới hạn / công tắc tắt | [mcp-oauth.md](mcp-oauth.md) |
| Báo cáo + Excel (bảng công, tiền tăng ca, tiền phép khi nghỉ việc), quy tắc lương giờ / ngày công chuẩn | [reports.md](reports.md) |
| Đặt phòng họp, chặn trùng giờ, mời họp, bảng "Đang họp" trong 3D | [meetings.md](meetings.md) |
| Lịch sử sửa dữ liệu nhân sự (`[Audited]`, interceptor, che lương), nhật ký | [audit.md](audit.md) |
| Nhập nhân viên từ Excel (mẫu, xem trước, nhập hết hoặc không) | [employee-import.md](employee-import.md) |

## Nguyên tắc chung

- **Vai trò** (`Roles`): `admin`, `hr`, `manager`, `employee`. Policy: `AuthPolicies.Hr` = admin|hr (mọi thao tác ghi dữ liệu nhân sự, ca, lịch), `AuthPolicies.Manager` = admin|hr|manager (xem bảng công người khác). Manager chỉ thấy **bản thân + cấp dưới** (theo `ManagerId`, cả gián tiếp, qua `GetSubordinateIdsAsync`). Kiểm tra quyền luôn ở back-end; menu / guard FE chỉ để điều hướng.
- **Tài khoản ≠ nhân viên**: `identity.users` (đăng nhập) và `org.employees` (hồ sơ) liên kết bằng `employees.UserId`. Tài khoản không có hồ sơ (admin seed) đăng nhập được nhưng không chấm công.
- **Múi giờ**: mọi tính toán ngày giờ dùng `Office__TimeZone` (`Asia/Ho_Chi_Minh`). DB lưu `DateTimeOffset` UTC; `WorkDate` là ngày địa phương. FE hiển thị qua `utils/date.ts` cùng múi giờ.
- **Giờ do server quyết định** (chấm công). Không tin giờ trình duyệt.
- **Xoá mềm** dữ liệu nhân sự (`DeletedAt` / `Status = Resigned`); sự kiện chấm công không bao giờ sửa.
- **Lỗi** trả ProblemDetails với `detail` tiếng Việt; validate theo field (400) dùng key camelCase. FE hiển thị qua `fieldErrors` / `errorMessage`.
- **Thông báo tiếng Việt** viết trực tiếp trong code back-end (chưa có i18n).

## Điểm cần lưu ý / nợ kỹ thuật đã biết

1. **SMTP Gmail trên macOS**: MailKit kiểm tra thu hồi chứng chỉ (CRL/OCSP); trên macOS dev báo "incomplete certificate revocation check". Có tuỳ chọn `Smtp__CheckCertificateRevocation` (mặc định `true`); chỉ chủ dự án tự đặt `false` trong `.env` dev. Agent **không** tự đổi giá trị này.
2. Realtime phụ thuộc Api để kiểm tra phiên; Api không phản hồi thì **cho qua** (fail-open) — người bị khoá có thể vào văn phòng 3D trong lúc Api sập. Người đang online bị đẩy ra trễ tối đa `Realtime__SessionCheckSeconds`.
3. Không có transaction trải nhiều module (xem [database.md](../database.md#không-có)).
4. 2FA: `LoginAsync` có nhánh `RequiresTwoFactor` nhưng chưa có API bật 2FA.
5. Không có chống CSRF (antiforgery); đang dựa vào `SameSite=Lax` + body JSON (cần xác nhận khi lên production).
6. Khai báo nhưng chưa dùng: `Office__InactiveMinutes`, FE `ENV`, `REALTIME.voiceToken`, `VITE_SENTRY_DSN`, `src/assets/icons|images` trống.
7. Registry shadcn `new-york-v4` viết sẵn `import { cn } from "cn"` và CLI cài gói npm rác `cn` → luôn thêm component bằng `bun run ui:add` (`frontend/scripts/ui-add.ts` tự sửa import + gỡ gói). CLI hỏi ghi đè file đã có (vd. `button.tsx` khi thêm `sidebar`) → trả lời `n` trừ khi muốn cập nhật.
8. Dev chạy qua Vite proxy → IP là localhost → chấm công luôn `Remote` trừ khi `Office__IpRanges` chứa `127.0.0.1/32`.
9. Bảng công và quỹ phép tính lại mỗi lần đọc (đủ nhanh cho ~12 người). Chưa có "chốt công", quy ra tiền tăng ca / giờ làm đêm, giờ lõi ca linh hoạt, ca qua đêm, quy ra tiền phép năm, tuỳ chọn tắt email thông báo.
10. `reactivate` không khôi phục `ManagerId` / `HeadEmployeeId` đã bị gỡ khi nghỉ việc. `departments.HeadEmployeeId` không có FK.
11. Văn phòng 3D là bản tối giản (sàn, vùng, avatar capsule); code game MVP cũ đã được xoá có chủ ý, engine đầy đủ sẽ viết mới trong `features/office/engine`.
12. FE không có lint và test tự động; BE chỉ có test kiến trúc + test `TimesheetCalculator`.
13. DB dev là Postgres dùng chung của công ty; admin seed đang dùng giá trị mẫu của `.env.example` (đã biết, chủ dự án chấp nhận khi dev).
