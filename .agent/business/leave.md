# Nghỉ phép (module Leave)

> Nguồn sự thật là code (`backend/src/Modules/Leave/`, `frontend/src/features/leave/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Route `/api/leave` (đăng nhập). Duyệt qua [approval.md](approval.md). Đếm ngày làm việc qua `IWorkCalendar` (Attendance). Bảng công đọc ngày nghỉ qua `ILeaveCalendar` ([attendance.md](attendance.md)).

## Loại phép (seed `LeaveSeeder`, bảng `leave.types`)

| Code | Tên | `IsPaid` | Trừ quỹ phép năm |
|---|---|---|---|
| `annual` | Phép năm | ✔ | ✔ (`UsesAnnualBalance`) |
| `sick` | Nghỉ ốm | — | — |
| `personal_paid` | Việc riêng có lương (cưới, tang…) | ✔ | — |
| `unpaid` | Nghỉ không lương | — | — |

Chưa có API thêm / sửa loại phép.

## Quỹ phép năm (`Domain/AnnualLeavePolicy.cs` — hàm thuần, test ở `tests/OfficeHub.Modules.Leave.Tests`)

- Mỗi năm: **12 ngày + 1 ngày cho mỗi 5 năm thâm niên** (thâm niên tính tại 1/1 của năm đó).
- Cộng dồn theo tháng: mỗi tháng = 1/12 số ngày của năm. Tính từ tháng vào làm tới **tháng hiện tại (tính luôn)**, dừng ở tháng nghỉ việc. Làm tròn 2 chữ số.
- **Phép còn lại tự chuyển sang năm sau, không hết hạn** (chủ dự án chốt). Số dư = tổng tích luỹ mọi năm.
- **Quy ra tiền: chưa làm.** UI hiện "Đang phát triển" (nhân viên đề xuất, HR duyệt — khi làm sẽ là loại đơn Approval mới).

Số dư (`LeaveBalanceService.ComputeAsync`, năm = năm hiện tại theo `Office__TimeZone`):

| Field | Cách tính |
|---|---|
| `AccruedThisYear` | tích luỹ năm nay |
| `CarriedFromPreviousYears` | tích luỹ các năm trước + điều chỉnh trước 1/1 − đã nghỉ (đơn `Approved`, `StartDate` năm trước) |
| `AdjustedThisYear` | điều chỉnh tạo từ 1/1 |
| `UsedThisYear` | đơn phép năm `Approved` có `StartDate` từ năm nay (gồm cả ngày tương lai) |
| `Pending` | đơn phép năm `Pending` (giữ chỗ) |
| `Available` | tổng tích luỹ + mọi điều chỉnh − mọi đơn đã duyệt − đang chờ |

## Gửi đơn (`POST /requests`, `Features/LeaveEndpoints.cs`) — giữ nguyên thứ tự

`{ leaveTypeId, startDate, endDate, period: FullDay|Morning|Afternoon, reason? }`

1. Tài khoản không có hồ sơ → 409 `title: "no_employee_profile"`; nghỉ việc → 403.
2. Validate: `"Loại nghỉ không hợp lệ"`, `"Ngày kết thúc phải từ ngày bắt đầu trở đi"`, `"Một đơn tối đa 60 ngày"`, `"Nghỉ nửa ngày chỉ áp dụng cho một ngày"`, `"Không xin nghỉ được trước ngày vào làm"`, lý do ≤ 500.
3. `Days` = số ngày có ca và không phải ngày lễ (`IWorkCalendar.WorkingDaysAsync`); nửa ngày = 0.5. Bằng 0 → `"Khoảng ngày đã chọn không có ngày làm việc nào (ngày nghỉ / ngày lễ)"`.
4. Trùng đơn `Pending` / `Approved` → `"Đã có đơn nghỉ dd/MM/yyyy–dd/MM/yyyy trùng ngày"`. **Ngoại lệ:** hai đơn nửa ngày khác buổi cùng ngày.
5. Phép năm: `Days > Available` → `"Không đủ phép năm: còn X ngày, đơn này cần Y ngày"` (key `leaveTypeId`).
6. Lưu `Pending` → `IApprovalService.SubmitAsync([Manager, Hr])` → lưu `ApprovalRequestId`. Gửi duyệt lỗi → **xoá đơn vừa tạo** rồi ném lỗi.

Ngày quá khứ được phép (nghỉ ốm khai sau). Được xin phép năm vào ngày tương lai bằng số dư hiện tại. **Không có API sửa đơn**: huỷ (qua `/api/approval/{id}/cancel`) rồi gửi lại. Không huỷ được đơn đã duyệt.

`LeaveApprovalHandler`: Approved / Rejected (lưu `RejectReason`) / Cancelled — chỉ khi đơn còn `Pending`.

## Endpoint khác

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/types` | đăng nhập | loại đang dùng |
| GET | `/balance` | nhân viên | số dư của tôi |
| GET | `/preview?startDate&endDate&period` | nhân viên | `{ days, workingDays[] }` — FE hiện trước khi gửi |
| GET | `/requests/my?year=` | nhân viên | 200 đơn mới nhất |
| GET | `/requests?from&to` | Manager policy | đơn `Pending` + `Approved` trong khoảng; HR: tất cả, manager: bản thân + cấp dưới |
| GET | `/balances` | HR | số dư mọi người đang làm |
| GET / POST | `/adjustments` | HR | `{ employeeId, days, reason }`: ≠ 0, \|days\| ≤ 365, bội số 0.5, lý do bắt buộc. **Không sửa / xoá** — sai thì thêm điều chỉnh ngược |

`ILeaveCalendar.GetApprovedAsync` trả từng ngày (kể cả ngày nghỉ cuối tuần trong khoảng) của đơn `Approved`: `Fraction` 1 hoặc 0.5, `Half` Morning/Afternoon.

## UI (`frontend/src/features/leave/`)

- `LeavePage` tabs: Của tôi (mọi người) · Lịch nghỉ (admin/hr/manager) · Quỹ phép (admin/hr). Nút "Xin nghỉ" ẩn khi `noProfile`.
- `BalanceCard` (từng dòng cộng/trừ), `YearEndCard` (chuyển sang năm sau — tự động; quy ra tiền — nút tắt "Đang phát triển").
- `LeaveRequestDialog`: chọn "Buổi" chỉ khi 1 ngày; xem trước số ngày (`useLeavePreview`, debounce 300ms); nút gửi tắt khi 0 ngày.
- `MyLeavesTable` (huỷ đơn chờ duyệt bằng `useCancelApproval` từ `@/features/approvals`), `TeamCalendar` (chọn tháng), `BalancesTable` + dialog điều chỉnh.
- Dashboard dùng `useMyBalance` hiện "Phép năm còn lại".
