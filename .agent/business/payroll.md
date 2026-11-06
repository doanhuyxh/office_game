# Bảng lương (module `Payroll`, schema `payroll`)

Chủ dự án chốt 2026-11-06: **tính đầy đủ theo luật VN**, mọi thông số (lương cơ sở, lương tối thiểu vùng, tỉ lệ bảo hiểm, trần, giảm trừ, biểu thuế) HR sửa được. Thông số mặc định là của 2026 mà hệ thống biết → **kế toán phải đối chiếu văn bản hiện hành trước khi chốt lương thật** (UI có cảnh báo).

## Dữ liệu vào (chỉ qua `*.Contracts`)

| Nguồn | Dùng |
|---|---|
| `IEmployeeDirectory.ListEmployedAsync` | Ai có phiếu: làm ít nhất một ngày trong tháng (gồm người nghỉ giữa tháng) |
| `IAttendanceReports.MonthAsync` | Trạng thái từng ngày (Present / Working / MissingCheckout = có đi làm) |
| `ILeaveCalendar` | Phần ngày nghỉ **có lương** đã duyệt (cộng tối đa 1 ngày) |
| `IAttendanceReports.ApprovedOvertimeAsync` | Tăng ca đã duyệt (phút, hệ số %) |
| `IWorkCalendar.ScheduledDatesAsync` / `WorkingDaysAsync` | Công chuẩn = số ngày có ca; ngày lễ rơi vào ngày có ca = hưởng lương |
| `ISalaryLookup.GetAsync(ids, ngày)` | Lương + phụ cấp + loại HĐ tại ngày cuối kỳ (người nghỉ: ngày nghỉ việc) — gồm phụ lục |

## Công thức (`Domain/PayrollCalculator.cs`, hàm thuần — test `tests/OfficeHub.Modules.Payroll.Tests`)

1. Công hưởng lương = ngày đi làm + nghỉ có lương + lễ có ca. Lương theo công = lương HĐ × công / công chuẩn; phụ cấp cùng tỉ lệ.
2. Tăng ca = giờ × lương giờ (lương ÷ công chuẩn ÷ 8) × hệ số (`PayRules`, project `OfficeHub.Modules.Payroll.Contracts`, Reporting dùng chung). Phần vượt lương giờ thường miễn thuế (`OvertimePremiumTaxExempt`).
3. Bảo hiểm NLĐ 8 / 1,5 / 1 % (DN 17,5 / 3 / 1 %) trên lương đóng BH = lương HĐ (+ phụ cấp nếu `InsuranceIncludesAllowance`), **không phụ thuộc số công** — trừ tháng có ≥ `UnpaidDaysNoInsurance` (mặc định 14, 0 = tắt) ngày công chuẩn không hưởng lương: tháng đó không đóng BH (có cảnh báo); trần BHXH/BHYT = 20 × lương cơ sở, BHTN = 20 × lương tối thiểu vùng.
4. Thuế TNCN: lũy tiến từng phần trên (thu nhập chịu thuế − BH − giảm trừ bản thân − số người phụ thuộc × giảm trừ). **HĐ thử việc**: mặc định không đóng BH, khấu trừ thẳng 10 % khi thu nhập ≥ 2 triệu.
5. Khoản cộng/trừ do HR nhập: `Taxable` → vào thu nhập chịu thuế (thưởng); không → cộng/trừ sau thuế (tạm ứng, hoàn ứng).
6. Thực lĩnh = tổng thu nhập − BH − thuế ± khoản không chịu thuế. Làm tròn tới đồng. Cảnh báo trong phiếu: thiếu HĐ / lương, kỳ chưa hết tháng, không đóng BH tháng này, thực lĩnh âm…

## Bảng

- `settings` (EffectiveFrom, RulesJson) — bản có hiệu lực mới nhất ≤ ngày 1 của tháng. `PayrollMigrator` seed bản mặc định từ 2026-01-01.
- `profiles` [Audited]: người phụ thuộc, `Insured` (null = tự động theo HĐ), MST, ghi chú.
- `periods` [Audited]: tháng, Draft / Locked, tổng hợp, bộ thông số đã dùng.
- `payslips`: `DataEncrypted` (JSON `PayslipData`, AES-GCM `IFieldEncryptor`) — xoá & ghi lại trong 1 transaction mỗi lần tính.
- `adjustments` [Audited]: nhãn, `AmountEncrypted`, Taxable.

## API `/api/payroll`

| | Đường dẫn | Ghi chú |
|---|---|---|
| HR | `GET/POST /settings` | POST `{ effectiveFrom, rules }`; validate: tỉ lệ 0–50 %, bậc thuế tăng dần, bậc cuối không giới hạn |
| HR | `GET /profiles`, `PUT /profiles/{employeeId}` | |
| HR | `GET/POST /periods`, `GET /periods/{id}` | POST `{ month: "yyyy-MM" }` tạo + tính ngay; trùng → 409; tháng tương lai → 400 |
| HR | `POST /periods/{id}/compute \| lock \| unlock` | Lock: tính lại lần cuối, **chỉ khi tháng đã kết thúc**, gửi chuông `payslip_ready` (không email) |
| HR | `GET /periods/{id}/export.xlsx` | ClosedXML |
| HR | `POST /periods/{id}/adjustments`, `DELETE /adjustments/{id}` | Tự tính lại; kỳ đã chốt → 409 |
| Mọi người | `GET /my` | Chỉ phiếu của kỳ **đã chốt** |

`/api/payroll` bị chặn với token AI (`AccessTokenAuth`) — lương không bao giờ ra MCP.

## UI (`frontend/src/features/payroll/`)

- `/payroll` (HR, menu Tổ chức → "Bảng lương"): tab **Kỳ lương** (tạo & tính, bảng tổng, bấm dòng → phiếu + khoản cộng/trừ, tính lại, Excel, chốt / mở lại), **Hồ sơ thuế**, **Thông số** (sửa + biểu thuế, lưu với ngày hiệu lực).
- `/payslips` (mọi người, menu Công việc → "Phiếu lương"): phiếu các tháng đã chốt (`PayslipView`).
