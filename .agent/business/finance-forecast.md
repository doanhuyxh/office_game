# Dự báo dòng tiền 13 tuần (back-end)

> Nguồn sự thật là code: `Finance/Domain/CashForecastRules.cs` (hàm thuần) + `Finance/Features/ForecastEndpoints.cs`; dữ liệu từ `Sales.Contracts/ISalesOutlook` (`OpenInstallmentsAsync`, `OpenOpportunitiesAsync`), `Payroll.Contracts/IPayrollCosts.MonthTotalAsync`, `Assets.Contracts/IServiceRenewals`. Tổng quan giám đốc 2/3 (TEST-221) — về [finance-dashboard.md](finance-dashboard.md) · kế hoạch [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md) §7.

## Nguyên tắc

- Tính **khi đọc, không lưu**. Endpoint chỉ gom dữ liệu rồi gọi `CashForecastRules.Build`.
- Đọc: quyền tài chính **Xem** (chức vụ). Sửa cấu hình / khoản định kỳ: **Quản trị tài chính**. Admin / HR / quản lý dự án / nhân viên thường → 403.
- **Token AI 403** mọi route ở đây (không nằm trong allowlist `AccessTokenAuth`). Không có tool MCP; bảng số trong 3D + tool MCP: để sau.
- Chủ dự án chốt 2026-11-23: lương trả **ngày 10 tháng sau** (sửa được); tiền cơ hội về sau ngày dự kiến chốt **30 ngày** (sửa được); cơ hội không có ngày dự kiến chốt **không** vào dự báo; công nợ quá hạn chỉ ở đường **Kỳ vọng**, dồn tuần 1.

## API

| Method | Route | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/finance/forecast` | View | Dự báo 13 tuần + cấu hình đang dùng |
| PUT | `/api/finance/forecast/settings` | Admin | `{ payrollPayDay 1–28, pipelineDelayDays 0–180 }` → 204; sai → 400 theo field |
| GET | `/api/finance/recurring` | View | Khoản định kỳ dự kiến (đang dùng trước) |
| POST / PUT | `/api/finance/recurring[/{id}]` | Admin | `{ name ≤200 duy nhất, kind Income/Expense, amount 1…LedgerRules.MaxAmount, dayOfMonth 1–28, businessLineId?, isActive, note ≤1000 }` |

### `/forecast` → `CashForecastDto`

- `today`, `to` (Chủ nhật tuần 13), `opening` (tổng số dư quỹ **đang dùng**, như `/accounts`), `settings { payrollPayDay, pipelineDelayDays }`, `payroll { monthlyCost, estimated }`.
- `weeks[13]`: `week`, `from`, `to`, các dòng `installments`, `overdue`, `pipeline`, `recurringIncome` (vào) · `payroll`, `renewals`, `expenses`, `recurringExpense` (ra) · `inConservative`, `inExpected`, `out`, `closingConservative`, `closingExpected`.
- `items[]` — khoản tạo nên từng ô: `week`, `line` (`Installment|Overdue|Pipeline|RecurringIncome|Payroll|Renewal|Expense|RecurringExpense`), `date` (ngày gốc; null = đề nghị chi không có ngày cần), `amount` (> 0), `name`, `refId` (hợp đồng / cơ hội / dịch vụ / đề nghị chi / khoản định kỳ; lương = null), `refCode` (mã HĐ / mã CP), `customerId`, `late` (ngày gốc đã qua → dồn tuần 1).
- `firstNegativeConservative` / `firstNegativeExpected` (tuần đầu số dư âm, null = không âm), `undatedOpportunities` / `undatedValue` / `undatedWeighted` (cơ hội chưa có ngày — chỉ báo).

## Quy tắc (`CashForecastRules`)

- **Tuần**: tuần 1 = hôm nay (giờ VN, `FinanceClock`) → Chủ nhật; tuần 2–13 Thứ Hai → Chủ nhật. Khoản có ngày sau `to` không tính.
- **Đợt thu** (`OpenInstallmentsAsync`: HĐ Active, đợt chưa huỷ, còn lại = số tiền − đã thu qua `CollectedCalculator` — huỷ dòng thu ở sổ → đợt quay lại): hạn ≥ hôm nay → tuần chứa hạn; hạn đã qua → dòng `Overdue` tuần 1.
- **Cơ hội** đang mở có `ExpectedCloseOn`: tiền = `SalesRules.Weighted`; ngày về = ngày chốt + `PipelineDelayDays`; đã qua → tuần 1.
- **Lương**: một **tổng** (`MonthTotalAsync` tháng hiện tại = Gross + BH công ty mọi phiếu; chưa chốt → ước tính đủ công, `estimated`) lặp cho mỗi kỳ trả: lương tháng M trả ngày `PayrollPayDay` tháng M+1 (tháng thiếu ngày → cuối tháng). Kỳ ≤ hôm nay **coi như đã chi** — sổ chưa nối bảng lương. Không có chi tiết theo người.
- **Gia hạn dịch vụ** (`AssetRules.HasRenewalCost`: Active, chu kỳ ≠ None, `Cost` > 0, có `RenewalDate`): Monthly lặp mỗi tháng, Yearly mỗi năm, từ `RenewalDate`; `RenewalDate` đã qua (chưa cập nhật) → thêm một khoản tuần 1 `late` ("quá ngày gia hạn"), các kỳ sau vẫn tính theo chu kỳ.
- **Đề nghị chi** `Approved` (chưa chi): theo `NeededBy`; trống / đã qua → tuần 1. Đã chi → rời dự báo.
- **Khoản định kỳ** đang dùng: ngày `DayOfMonth` mỗi tháng, ngày ≤ hôm nay coi như đã thu / chi (như lương).
- **Thận trọng** = đợt thu chưa quá hạn + định kỳ thu − mọi khoản chi. **Kỳ vọng** = Thận trọng + công nợ quá hạn + cơ hội × xác suất. Số dư cuối tuần cộng dồn từ `opening`.

## Dữ liệu

- `finance.settings`: thêm `PayrollPayDay` (mặc định 10), `PipelineDelayDays` (mặc định 30) — `FinanceSettings` `[Audited]`.
- `finance.recurring_items` (không `[Audited]` vì có số tiền, như quỹ): chỉ là **số dự kiến** — không sinh dòng sổ, không sinh đề nghị chi; không xoá, chỉ ngừng (`IsActive`). Migration `AddCashForecast` — [database.md](../database.md).
- Chi phí dịch vụ trước chỉ HR thấy (trang Tài sản); nay người có Xem tài chính thấy trong dự báo ([assets.md](assets.md)).

## Kiểm thử

- Unit: `Finance.Tests/CashForecastRulesTests` (tuần khi hôm nay Thứ Hai / Chủ nhật, hạn đúng Chủ nhật, lương 0 / 3 / 4 lần, ngày trả = hôm nay, dịch vụ tháng / năm / quá hạn, cơ hội + trễ ra ngoài cửa sổ, cơ hội không ngày, Thận trọng không gồm quá hạn + cơ hội, tuần âm đầu tiên), `Assets.Tests/AssetRulesTests` (`HasRenewalCost`).
- e2e: phần TEST-221 của `scripts/dev/finance-dashboard-e2e.ts` (DB tạm) — [e2e.md](../e2e.md).
