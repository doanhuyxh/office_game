# Ca làm, lịch tuần, ngày lễ + UI chấm công (module Attendance)

> Nguồn sự thật là code (`Features/Shifts/ShiftEndpoints.cs`, `frontend/src/features/attendance/`). Về [attendance.md](attendance.md).

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
