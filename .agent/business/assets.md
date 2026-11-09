# Tài sản công ty — thiết bị + dịch vụ / tài khoản (module Assets)

> Nguồn sự thật là code (`backend/src/Modules/Assets/`, `frontend/src/features/assets/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md). Schema: [database-workflow.md](../database-workflow.md#schema-assets--assetsdbcontext-migration-initialassets).

Không nhầm với [documents.md](documents.md) ("tài sản số" = file do công việc sinh ra, **không** tính là tài sản ở module này).

## Phạm vi (chủ dự án chốt 2026-11-08)

- Chỉ tài sản **của công ty** (không BYOD). Hai nhóm: **thiết bị** (máy tính, màn hình, điện thoại, phụ kiện) và **dịch vụ / tài khoản phần mềm** (Figma, Google Workspace, Slack, GitHub…).
- **Không lưu mật khẩu** (chưa có trình quản lý mật khẩu). Chỉ ghi tên đăng nhập / email của tài khoản.
- 2026-11-09 chủ dự án mở lại: **khấu hao** đường thẳng, **biên bản giao nhận** (nhân viên bấm xác nhận trong app), **ảnh / hoá đơn** thiết bị → [assets-handover.md](assets-handover.md).
- Một giai đoạn gồm: đăng ký, cấp phát / thu hồi, thu hồi khi nghỉ việc, nhắc hạn, tổng quan, **và** rà soát quyền định kỳ + kiểm kê + xuất Excel + tool MCP (chủ dự án thêm 2026-11-08) — phần sau ở [assets-review.md](assets-review.md).

## Dữ liệu (schema `assets`, `AssetsDbContext`, migration `InitialAssets`)

Tham chiếu nhân viên bằng `EmployeeId` thuần (không FK chéo schema); tên / trạng thái lấy qua `IEmployeeDirectory`.

| Bảng | Cột chính |
|---|---|
| `categories` | `Code` (tiền tố mã: MT, MH, DT, PK, KH), `Name`, `SortOrder`, `IsActive`. Seed 5 loại; HR thêm / sửa |
| `devices` `[Audited]` | `Code` `TB-{loại}-{00001}` (bộ đếm theo loại, bảng `sequences`), `CategoryId`, `Name`, `Brand`, `Model`, `SerialNumber` (duy nhất khi có), `PurchaseDate`, `PurchasePrice` (VND), `WarrantyUntil`, `DepreciationMonths?` (riêng, null = theo loại), `Status`, `HolderEmployeeId`, `Note`, `DeletedAt`, `WarrantyReminded30At/7At` |
| `device_assignments` | `DeviceId`, `EmployeeId`, `AssignedAt/By`, `ReturnedAt/By`, `ReturnNote` — chỉ thêm / đóng, không xoá (lịch sử giao nhận) |
| `services` `[Audited]` | `Name`, `Vendor`, `Plan`, `Url`, `SeatLimit` (null = không giới hạn), `BillingCycle` (None / Monthly / Yearly), `Cost` (VND/kỳ), `RenewalDate`, `OwnerDepartmentId`, `AdminEmployeeId`, `Status` (Active / Cancelled), `RenewalReminded30At/7At` |
| `service_seats` `[Audited]` | `ServiceId`, `EmployeeId`, `AccountLogin`, `Role`, `GrantedAt/By`, `RevokedAt/By`, `Note`. Duy nhất `(ServiceId, AccountLogin)` khi chưa thu hồi |
| `offboarding_notices` | `EmployeeId` (duy nhất), `NotifiedAt` — để job chỉ báo một lần mỗi người |

`DeviceStatus`: `InStock` (trong kho) → `InUse` (đang dùng) ↔ `InStock`; `Repair` (bảo trì, về `InStock`); `Retired` (thanh lý), `Lost` (mất) — hai trạng thái cuối bắt buộc **lý do**, không quay lại.

## Quy tắc (`Domain/AssetRules.cs`, thuần, có test)

- Cấp thiết bị: chỉ khi `InStock`; nhân viên phải **còn làm** (`IsActive`). → `InUse`, mở `device_assignments`, đặt `HolderEmployeeId`.
- Thu hồi: đóng bản ghi giao nhận, → `InStock`. `Lost` khi đang `InUse` cũng đóng bản ghi. `Retired` / `Lost` không cấp được nữa; `Repair` / `Retired` khi đang `InUse` → 409 "Hãy thu hồi trước".
- Cấp ghế (cả khi `SeatLimit` null): dịch vụ `Active` và `ghế đang dùng < SeatLimit` (hết → 409 "Đã hết ghế"). Một nhân viên được nhiều tài khoản trên cùng dịch vụ. Thu hồi ghế ghi `RevokedAt`, không xoá.
- Huỷ dịch vụ (`Cancelled`): tự thu hồi mọi ghế đang dùng.
- Xoá thiết bị (mềm): chỉ khi chưa từng cấp. Còn lại dùng `Retired`.
- Hạn nhắc (đổi hạn → xoá cờ để nhắc lại): `DueReminder(hạn, hôm nay, đã nhắc 30/7)` giống [contracts-reminders.md](contracts-reminders.md) (≤7 ngày → nhắc 7 và đặt cả cờ 30; 8–30 → nhắc 30).

## Quyền

| Ai | Được |
|---|---|
| HR / admin (`AuthPolicies.Hr`) | Toàn bộ: danh mục, thiết bị, dịch vụ, cấp / thu hồi, tổng quan. Chỉ HR thấy giá mua / chi phí |
| Manager | Xem tài sản đang giữ của bản thân + cấp dưới (`GetSubordinateIdsAsync`), không thấy giá |
| Nhân viên | Chỉ xem tài sản đang giữ của mình (tên, mã, serial, tên đăng nhập; không giá) |

## Thông báo (`INotifier`, ghi cờ ngay sau khi gửi, không ném lỗi)

| Khi | Ai nhận | Kênh | `Category` |
|---|---|---|---|
| Cấp thiết bị / ghế | Nhân viên được cấp | chuông + email | `asset_assigned` |
| Thu hồi thiết bị / ghế | Nhân viên bị thu hồi | chỉ chuông | `asset_returned` |
| Bảo hành / gia hạn dịch vụ còn ≤ 30, ≤ 7 ngày | HR (không có → admin) + `AdminEmployeeId` của dịch vụ | chuông + email | `asset_expiring` |
| Nhân viên nghỉ việc mà còn giữ thiết bị / ghế (một lần) | HR + quản lý trực tiếp cũ nếu có | chuông + email | `asset_offboarding` |

`AssetsMaintenanceJob` (`BackgroundService` trong Api, 30 giây sau khởi động rồi **mỗi giờ**, giả định một instance Api): nhắc hạn + quét nhân viên đã nghỉ còn giữ tài sản (`IEmployeeDirectory`, so `IsActive`; Organization không gọi sang Assets nên dùng job, không dùng sự kiện). Link thông báo: `/assets`.

## Endpoint (`/api/assets`, đăng nhập; ghi = HR)

| Method | Path | Ghi chú |
|---|---|---|
| GET/POST/PUT | `/categories` | HR ghi |
| GET | `/devices?search=&categoryId=&status=&holderId=&page=&pageSize=` | HR; phân trang theo quy ước; tìm theo mã, tên, serial, tên người giữ |
| POST/PUT/DELETE | `/devices`, `/devices/{id}` | |
| GET | `/devices/{id}` | chi tiết + lịch sử giao nhận |
| POST | `/devices/{id}/assign` `{ employeeId, note? }` · `/return` `{ note? }` · `/status` `{ status, reason? }` | |
| GET/POST/PUT | `/services`, `/services/{id}` · POST `/services/{id}/cancel` | |
| GET/POST | `/services/{id}/seats` `{ employeeId, accountLogin, role?, note? }` · POST `/seats/{id}/revoke` | |
| GET | `/employees/{id}/holdings` | `{ devices, seats }`; HR, quản lý của người đó, chính chủ |
| GET | `/my` | tài sản của chính mình |
| GET | `/overview` | HR: đếm theo trạng thái, tổng giá mua, sắp hết hạn, ghế chưa dùng, người nghỉ còn giữ |

## Front-end (`features/assets`, route `/assets`, mọi vai trò)

- Không tiêu đề trang; nút hành động trên hàng tab (`PageToolbar`).
- HR: tab **Tổng quan** (đầu tiên, mở mặc định), **Thiết bị** (bảng + sheet chi tiết: cấp, thu hồi, đổi trạng thái, lịch sử), **Dịch vụ** (ghế theo dịch vụ), **Danh mục**. Người khác: chỉ **Của tôi**. Có thêm tab **Rà soát** và **Kiểm kê** ([assets-review.md](assets-review.md)); quản lý thấy thêm khung "Việc cần rà soát" ở tab Của tôi.
- Export `EmployeeHoldings` qua `@/features/assets` để hiện trong chi tiết nhân viên; `ResignDialog` cảnh báo "còn giữ N thiết bị, M ghế" (không chặn nghỉ việc).
- Hộp thoại nhân viên nạp lười `EmployeeHoldings` (tránh vòng import employees ↔ assets). Menu "Tài sản" (nhóm Công việc, sau Tài liệu).

## Test

`tests/OfficeHub.Modules.Assets.Tests/AssetRulesTests.cs` (35: mã, cấp, đổi trạng thái, hết ghế, hạn nhắc, chi phí/tháng) · `ModuleBoundaryTests` (Assets chỉ dùng `Organization/Notification/Identity.Contracts`) · `scripts/dev/assets-e2e.ts a|b` trên DB tạm: 97 + 2 kiểm tra đạt 2026-11-08 ([e2e.md](../e2e.md)).
