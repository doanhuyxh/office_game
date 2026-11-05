# Chấm công (module Attendance)

> Nguồn sự thật là code (`backend/src/Modules/Attendance/`, `frontend/src/features/attendance/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Route dưới `/api/attendance` (đăng nhập). Schema: [database.md](../database.md#schema-attendance--attendancedbcontext-migration-initialattendance). Nhân viên tra qua `IEmployeeDirectory` ([organization.md](organization.md)).

## Nguyên tắc

1. **Sự kiện thô chỉ thêm** (`attendance.events`). Không sửa / xoá. Sửa công = giải trình được duyệt → thêm sự kiện `Manual` ([attendance-corrections.md](attendance-corrections.md)).
2. **Bảng công không lưu**: mỗi lần đọc, `AttendanceService.ComputeAsync(employees, from, to)` lấy events + schedules + holidays + ngày nghỉ đã duyệt (`ILeaveCalendar`) rồi gọi `TimesheetCalculator.Compute` (hàm thuần, test ở `tests/OfficeHub.Modules.Attendance.Tests`). Sửa quy tắc tính → sửa calculator **và** test.
3. **Server quyết định thời gian**: `TimeProvider` + `Office__TimeZone`. `WorkDate` = ngày địa phương lúc chấm.
4. Tài khoản không gắn hồ sơ nhân viên (vd admin seed) → **409**, `title: "no_employee_profile"`, `"Tài khoản chưa gắn hồ sơ nhân viên nên chưa chấm công được. Liên hệ HR."`.

## Chấm công (`Features/Check/CheckEndpoints.cs`)

| Method | Path | Kết quả |
|---|---|---|
| GET | `/today` | `TodayDto { employee, checkedIn, nextAction "in"\|"out", day, shift, serverTime, currentWorkMode }` |
| POST | `/check` | `{ source: "web" \| "office3d" }` → `TodayDto` sau khi ghi |

Bước của `/check` (giữ thứ tự):
1. Tìm nhân viên theo user; `IsActive=false` → 403 `"Nhân viên đã nghỉ việc"`.
2. Lấy sự kiện mới nhất **trong `WorkDate` hôm nay**. Cách < 1 phút → 409 `"Bạn vừa chấm công lúc HH:mm. Đợi 1 phút rồi thử lại."`.
3. `Type` = `Out` nếu sự kiện cuối là `In`, ngược lại `In` (sang ngày mới luôn bắt đầu `In`).
4. `Source`: `office3d` → `Office3D`, còn lại → `Web`. `WorkMode` = `OfficeNetwork.IsOnsite(RemoteIpAddress)` ? `Onsite` : `Remote` (so với `Office__IpRanges`; trống → luôn Remote). Lưu `Ip`, `UserAgent` (≤512).

Không cần đăng ký làm từ xa. Không giới hạn số lần vào/ra trong ngày.

## Quy tắc tính một ngày (`Domain/TimesheetCalculator.cs`)

- Ghép cặp: `In` khi đang mở phiên → bỏ qua; `Out` khi chưa vào → bỏ qua.
- Phiên mở: hôm nay → tính tới `now` (`Working`); ngày đã qua → `MissingCheckout`, **phiên đó không tính giờ**.
- `WorkedMinutes` = tổng các phiên − phần giao với giờ nghỉ (`BreakStart–BreakEnd`), làm tròn xuống phút.
- `WorkMode` ngày: một loại → `Onsite`/`Remote`; nhiều loại → `Mixed`.

| | Ca `Fixed` | Ca `Flexible` |
|---|---|---|
| Phải làm (`RequiredMinutes`) | `EndTime − StartTime − nghỉ` | `RequiredMinutes` |
| Đi muộn | `FirstIn > StartTime + GraceMinutes` → tính từ `StartTime` | `FirstIn > LatestIn` → tính từ `LatestIn` |
| `ShortMinutes` (chỉ khi `Present`) | về sớm: `EndTime − LastOut` | thiếu giờ: `Required − Worked` |

| Trạng thái (`DayStatus`) | Khi |
|---|---|
| `NotEmployed` | trước `JoinedAt` / sau `LeftAt` (gán ở `AttendanceService`, required = 0) |
| `Holiday` | ngày lễ, không chấm (required = 0) |
| `DayOff` | không có ca, không chấm |
| `NotYet` | không chấm, ngày tương lai hoặc hôm nay chưa hết ca |
| `Absent` | có ca, không chấm, đã qua / đã hết ca |
| `Working` / `Present` / `MissingCheckout` | như trên |

Làm ngày nghỉ / ngày lễ vẫn ghi `Present` với required = 0. **Chưa có**: giờ lõi ca linh hoạt (`EarliestIn` không dùng khi tính), tăng ca, ca qua đêm.

**Nghỉ phép đã duyệt** (`DayLeave`; sáng + chiều cùng ngày cộng thành cả ngày):

| | Nghỉ cả ngày | Nghỉ nửa ngày |
|---|---|---|
| Phải làm | 0 | một nửa |
| Không chấm công | `Leave` | `Absent` / `NotYet` (buổi còn lại) |
| Đi muộn / về sớm | không xét | nghỉ sáng → không xét muộn; nghỉ chiều → không xét về sớm (ca cố định) |

`Scheduled` = có ca và không phải ngày lễ. `DayDto` thêm `leaveFraction`, `leaveName`.

## Lịch làm việc (`AttendanceService.ShiftIdFor`)

Ca của nhân viên ngày D: bộ lịch **riêng** của nhân viên có `EffectiveFrom` lớn nhất ≤ D; nếu không có → bộ lịch **công ty** (`EmployeeId = null`). Lấy dòng theo `DayOfWeek`; `ShiftId` null = nghỉ.

## Bảng công (`Features/Timesheets/TimesheetEndpoints.cs`)

| Method | Path | Quyền | Phạm vi |
|---|---|---|---|
| GET | `/my?month=yyyy-MM` | nhân viên | cả tháng; `summary` chỉ tính tới hôm nay |
| GET | `/employees/{id}?month=` | `AuthPolicies.Manager` + `CanViewAsync` | HR: mọi người; manager: bản thân + cấp dưới; khác → 403 `"Bạn không có quyền xem bảng công của nhân viên này"` |
| GET | `/board?date=` | Manager | 1 ngày (mặc định hôm nay), nhân viên đang làm trong phạm vi |
| GET | `/report?month=` | Manager | tổng hợp tháng, tới hôm nay |

Tháng sai → 400 `"Tháng không hợp lệ (định dạng yyyy-MM)"`. `SummaryDto` (`DtoMap.Summary`): `WorkDays` = số ngày `Scheduled`; `PresentDays` = Present + Working + MissingCheckout; `LeaveDays` = tổng `LeaveFraction` ngày `Scheduled`; `RequiredMinutes` bỏ ngày `NotYet`.

## Ca, lịch, ngày lễ (`Features/Shifts/ShiftEndpoints.cs`)

| Path | Đọc | Ghi |
|---|---|---|
| `/shifts` | đăng nhập | HR: POST, PUT `/{id}`, DELETE `/{id}` (xoá mềm) |
| `/schedules` | HR | HR: `PUT { employeeId?, effectiveFrom, days[7] }`, `DELETE ?employeeId=&effectiveFrom=` |
| `/holidays?year=` | đăng nhập | HR: POST `{ date, name }`, DELETE `/{id}` |

Validate ca (giờ `"HH:mm"`): `"Ca cố định cần giờ vào"`, `"Ca cố định cần giờ ra"`, `"Giờ ra phải sau giờ vào (chưa hỗ trợ ca qua đêm)"`, `"Số phút cho phép trễ từ 0 đến 120"`, `"Số giờ phải đủ từ 1 đến 16 tiếng"`, `"Giờ vào muộn nhất phải sau giờ vào sớm nhất"`, `"Nhập đủ cả giờ bắt đầu và kết thúc nghỉ"`, `"Giờ kết thúc nghỉ phải sau giờ bắt đầu"`. Lưu ca `Fixed` thì xoá các field linh hoạt và ngược lại.

| Bị chặn | Thông báo |
|---|---|
| Xoá ca đang trong bộ lịch hiện hành / tương lai | 409 `"Ca đang được dùng trong lịch làm việc, hãy đổi lịch trước"` |
| Lịch không đủ 7 ngày | 400 `"Cần đủ 7 ngày trong tuần"` |
| Xoá bộ lịch công ty duy nhất | 409 `"Không thể xoá lịch công ty duy nhất"` |
| Trùng ngày lễ | 400 `"Ngày này đã là ngày lễ"` |

`GET /schedules` trả bộ đang hiệu lực + bộ tương lai cho công ty và từng nhân viên còn làm. Không có API sửa sự kiện chấm công.

**`IWorkCalendar`** (Attendance.Contracts → `WorkCalendar` trong `AttendanceService.cs`): ngày có ca và không phải ngày lễ — Leave dùng để đếm số ngày nghỉ.

## UI (`frontend/src/features/attendance/`)

- `CheckInCard` (dùng ở `Dashboard`, tab "Của tôi"): đồng hồ theo `serverTime`, nút `data-testid="check-button"` "Chấm công vào/ra" (source `web`), các phiên, hình thức sẽ ghi. `noProfile` → thẻ thông báo thay nút.
- `AttendancePage` tabs: Của tôi (mọi người) · Hôm nay + Tổng hợp tháng (`hasRole` admin/hr/manager) · Ca & lịch (admin/hr). Bấm dòng tổng hợp → dialog `MonthTimesheet` của người đó.
- `ShiftsPanel`, `SchedulesPanel` (lịch công ty + lịch riêng, áp dụng từ ngày chọn), `HolidaysPanel`.
- Văn phòng 3D chấm với source `office3d` → [office.md](office.md).
- Hook: `useToday` (refetch 60s, không retry khi 409), `useCheck`, `useMyMonth`, `useBoard`, `useReport`, …
