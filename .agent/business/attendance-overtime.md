# Tăng ca (module Attendance)

> Nguồn sự thật là code (`backend/src/Modules/Attendance/OfficeHub.Modules.Attendance/Features/Overtime/OvertimeEndpoints.cs`, `Domain/OvertimeRules.cs`, `frontend/src/features/attendance/components/OvertimeTab.tsx`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Nhân viên đăng ký **một khoảng giờ trong một ngày** → duyệt qua [approval.md](approval.md) (`ApprovalTypes.Overtime = "overtime"`, bước `[Manager, Hr]`) → bảng công cộng **đúng số giờ trên đơn**.

## Quy tắc (chủ dự án chốt 2026-11-05)

| Câu hỏi | Quyết định |
|---|---|
| Khi nào đăng ký | **Trước** (tối đa 31 ngày tới) **hoặc khai bù** trong **7 ngày** sau ngày tăng ca |
| Giờ được tính | **Theo giờ trên đơn đã duyệt**, không đối chiếu chấm công (ngày `Absent` / `DayOff` vẫn có giờ tăng ca) |
| Hệ số | Theo loại ngày (BLLĐ 2019 Đ.98): ngày có ca **150%** · ngày nghỉ tuần (không có ca) **200%** · ngày lễ **300%**. Chỉ thống kê giờ, **chưa quy ra tiền**, chưa tách giờ đêm |
| Giới hạn 40 giờ/tháng, 200 giờ/năm | **Chỉ cảnh báo**, không chặn. Tính trên đơn đã duyệt + đang chờ |

Loại ngày (`OvertimeRules.Classify`) xác định **lúc đọc** (lịch + ngày lễ hiện tại), không lưu trong đơn → HR thêm ngày lễ sau thì hệ số tự đúng. Hằng số ở `OvertimeRules` (đổi → sửa `tests/OfficeHub.Modules.Attendance.Tests/OvertimeRulesTests.cs`).

## Endpoint (`/api/attendance`, nhân viên)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/overtime/preview?workDate=&startTime=&endTime=` | `{ minutes, kind, percent, monthMinutes, yearMinutes, warnings[] }` — cùng validate như tạo (trừ lý do) |
| POST | `/overtime` | `{ workDate, startTime: "HH:mm", endTime, reason }` → `{ overtime: OvertimeDto, warnings[] }` |
| GET | `/overtime/my?month=yyyy-MM` | 200 dòng mới nhất, kèm `kind` / `percent` tính theo lịch hiện tại |

`kind` ∈ `Weekday` / `RestDay` / `Holiday`. Không có API sửa / xoá; huỷ qua `/api/approval/{id}/cancel`. Tài khoản không có hồ sơ → 409 `no_employee_profile`; đã nghỉ việc → 403.

## Validate (400 theo field)

| Field | Lỗi |
|---|---|
| `startTime` / `endTime` | `"Giờ phải có dạng HH:mm"` |
| `endTime` | `"Giờ kết thúc phải sau giờ bắt đầu (chưa hỗ trợ tăng ca qua đêm)"`, `"Tăng ca tối thiểu 15 phút"`, `"Mỗi đơn tối đa 12 giờ"` |
| `workDate` | `"Chỉ khai bù tăng ca trong 7 ngày gần nhất"`, `"Chỉ đăng ký trước tối đa 31 ngày"`, `"Ngày tăng ca trước ngày vào làm"` |
| `reason` | bắt buộc, ≤ 500 (chỉ khi tạo) |
| `startTime` | ca **cố định** trong ngày (không phải ngày lễ): khoảng giờ giao `[giờ vào, giờ ra)` của ca (kể cả nghỉ trưa) → `"Giờ tăng ca trùng giờ ca làm (08:30–17:30)"`. Ca linh hoạt: không kiểm tra |
| `startTime` | giao với đơn khác cùng ngày đang `Pending` / `Approved` → `"Trùng với đơn tăng ca khác trong ngày (18:00–20:00)"` |

Sau validate: lưu `Pending` → `SubmitAsync` (tóm tắt: giờ, số giờ, loại ngày + hệ số, lý do, **kèm cảnh báo vượt giới hạn `⚠ …`** để người duyệt thấy) → lưu `ApprovalRequestId`; gửi duyệt lỗi → xoá bản ghi.

## Khi duyệt (`OvertimeApprovalHandler`)

Idempotent: chỉ đổi khi đơn còn `Pending` → `Approved` / `Rejected` (+ `RejectReason`) / `Cancelled`, ghi `DecidedAt`. Không sinh sự kiện chấm công.

## Bảng công

`AttendanceService.ComputeAsync` cộng `Minutes` các đơn `Approved` theo (nhân viên, ngày) → `TimesheetCalculator.Compute(..., overtimeMinutes)` gán `OvertimeMinutes` + `OvertimeKind`.

- `DayDto`: `overtimeMinutes`, `overtimeKind`.
- `SummaryDto`: `overtimeMinutes`, `overtimeWeekdayMinutes`, `overtimeRestDayMinutes`, `overtimeHolidayMinutes` (bảng công của tôi: chỉ tới hôm nay → đơn đăng ký trước cho ngày tới chưa cộng).

## UI (`frontend/src/features/attendance/`)

- `AttendancePage` tab **Tăng ca** (ẩn khi `noProfile`) = `OvertimeTab`: chọn tháng, 4 thẻ tổng (tổng / 150% / 200% / 300%), bảng đơn của tôi (huỷ khi `Pending`), nút `data-testid="overtime-new"`.
- `OvertimeDialog` (trong `OvertimeTab.tsx`): ngày, từ – đến, lý do; xem trước gọi `/overtime/preview` (debounce 300 ms) hiện số giờ, loại ngày, tổng tháng / năm, cảnh báo. Gửi xong cảnh báo hiện thành toast.
- `MonthTimesheet`: cột "Tăng ca" (giờ + hệ số), thẻ "Tăng ca". `ReportTable`: cột "Tăng ca" (tooltip tách theo loại ngày).
- `APPROVAL_TYPE.overtime = "⏱ Tăng ca"` trong `features/approvals/utils/labels.ts`.
