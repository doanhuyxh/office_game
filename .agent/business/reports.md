# Báo cáo & quy ra tiền (module Reporting)

> Nguồn sự thật là code: `backend/src/Modules/Reporting/`, `frontend/src/features/reports/`. Về [README.md](README.md).

Module **không có DB**: đọc dữ liệu các module khác qua `*.Contracts` rồi tính theo `Domain/PayRules.cs` (test: `tests/OfficeHub.Modules.Reporting.Tests`).

| Contract dùng | Từ module | Việc |
|---|---|---|
| `IEmployeeDirectory.ListEmployedAsync(from, to)` | Organization | Nhân viên làm việc trong kỳ (gồm người đã nghỉ trong kỳ) |
| `IAttendanceReports.MonthAsync` / `ApprovedOvertimeAsync` | Attendance | Bảng công tháng (dùng lại `TimesheetCalculator`), tăng ca đã duyệt + loại ngày / hệ số |
| `IWorkCalendar.StandardDaysAsync` | Attendance | Ngày công chuẩn |
| `ILeaveBalances.GetAsync` | Leave | Quỹ phép (người đã nghỉ: tính tới ngày nghỉ việc) |
| `ISalaryLookup.GetAsync(ids, date)` | LaborContracts (project `*.Contracts` mới) | Lương / phụ cấp hiệu lực tại ngày D (giải mã, tính phụ lục) |

## Quy tắc tiền (chủ dự án chốt 2026-11-06 — đừng đề xuất lại)

- **Lương căn cứ** = lương trên hợp đồng hiệu lực (đã tính phụ lục), **không gồm phụ cấp**.
- **Ngày công chuẩn** = số ngày có ca theo lịch tuần trong tháng, **kể cả ngày lễ** (ngày lễ vẫn hưởng lương — Điều 112). Lương ngày = lương ÷ công chuẩn; lương giờ = lương ngày ÷ 8.
- **Tiền tăng ca** = giờ × lương giờ × hệ số 150 / 200 / 300 % (chỉ đơn đã duyệt). Mỗi dòng dùng lương **tại ngày tăng ca** + công chuẩn của tháng đó.
- **Tiền phép năm chưa dùng: trả khi nghỉ việc** (Điều 113) = ngày còn lại × lương ngày tại ngày nghỉ việc (công chuẩn tháng nghỉ việc). Còn lại ≤ 0 → 0 đ (ghi chú "dùng vượt"). Người đang làm chỉ xem **ước tính** theo lương hôm nay. Quỹ phép vẫn cộng dồn, không hết hạn ([leave.md](leave.md)).
- Làm tròn tới đồng ở số tiền cuối mỗi dòng. Thiếu hợp đồng / lương → tiền `null` + `warning` (không coi là 0).

## Endpoint (`/api/reports`, không có trong danh sách route của token AI)

| Method | Path | Quyền | Kết quả |
|---|---|---|---|
| GET | `/timesheet.xlsx?month=yyyy-MM` | Manager (HR: tất cả; quản lý: bản thân + cấp dưới) | 3 sheet: Tổng hợp · Lưới công (số giờ / P / ½P / L / V / Q / –) · Chi tiết (giờ vào / ra **đã đổi giờ VN**) |
| GET | `/overtime-pay?month=` · `.xlsx` | HR | Theo nhân viên + từng đơn: lương, công chuẩn, lương giờ, giờ theo hệ số, thành tiền. Có `page` → `OvertimePayPage` (chỉ người có tăng ca, kèm tổng tháng) |
| GET | `/leave-payout` · `.xlsx` | HR | Người đang làm + đã nghỉ trong năm: quỹ phép, lương ngày, tiền phép (`payoutDue` = đã nghỉ → phải trả). Có `page` → `LeavePayoutPage` (tính cho trang + `due` toàn bộ) |
| GET | `/leave-payout/me` | đăng nhập (web) | Tiền phép ước tính của chính mình (trang Nghỉ phép); 404 nếu chưa có hồ sơ |

Tháng sai định dạng → 400 `month`. Excel tạo bằng ClosedXML (`Infrastructure/ExcelExport.cs`).

## FE

- `/reports` (admin / hr / **manager**): quản lý chỉ thấy tab Bảng công + Trợ lý AI. Tab **Trợ lý AI** (`AiUsageTab`; dữ liệu từ module Audit — [mcp-oauth.md](mcp-oauth.md#nhật-ký-ai-module-audit-schema-audit)): bộ lọc khoảng ngày / phòng ban (HR) / ứng dụng / loại, ô số liệu, cột theo ngày (CSS), bảng theo nhân viên (bấm tiêu đề để sắp xếp, bấm dòng → sheet chi tiết + nhật ký), thao tác + ứng dụng. Tab HR: Bảng công (dùng lại `ReportTable` của attendance + nút Excel), Tiền tăng ca, Phép năm (khối "Cần thanh toán khi nghỉ việc").
- Trang Chấm công, tab báo cáo của quản lý: nút "Xuất Excel" (`/api/reports/timesheet.xlsx`).
- Trang Nghỉ phép, thẻ cuối năm: "Quy ra tiền khi nghỉ việc" + số tiền ước tính (`useMyLeavePayout`).
