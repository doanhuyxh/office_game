# Tổng quan giám đốc (back-end + giao diện)

> Nguồn sự thật là code: `Finance/Features/DashboardEndpoints.cs` + `Domain/DashboardRules.cs`, `Sales.Contracts/ISalesOutlook.cs` + `Sales/Infrastructure/SalesOutlook.cs` + `SalesRules.SummarizeReceivables / SummarizePipeline`, `Projects/Features/ProjectEndpoints.cs` (`FinancialAlertsAsync`) + `ProjectCostRules.Alerts`. Kế hoạch: [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md) §7 (TEST-50). Về [README.md](README.md) · [finance.md](finance.md) · [sales.md](sales.md) · [projects-finance.md](projects-finance.md).

Giai đoạn 5, chia 3 việc: **1/3 back-end số liệu (TEST-220, xong)** · **2/3 dự báo dòng tiền 13 tuần (TEST-221) → [finance-forecast.md](finance-forecast.md)** · **3/3 giao diện tab Tổng quan + Dự báo ở `/finance` (TEST-223, xong)** — mục [Giao diện](#giao-diện-test-223) bên dưới. Để sau: bảng số trong 3D + tool MCP (TEST-222).

## Nguyên tắc

- Mọi số tính ở back-end **khi đọc, không lưu**.
- Chỉ người có quyền tài chính **Xem** theo **chức vụ** (`IFinanceAccess`). Vai trò admin / hr / manager không thay thế → 403. Quản lý dự án không xem tiền.
- **Token AI không gọi được** 2 route mới (không nằm trong allowlist `AccessTokenAuth`) → 403, kể cả token của người có Xem. Không có tool MCP.
- `GET /api/finance/overview` **giữ nguyên DTO** (tool MCP `get_finance_overview` đang dùng).

## API

| Method | Route | Quyền | Mô tả |
|---|---|---|---|
| GET | `/api/finance/dashboard?months=12` | `RequireFinance(View)` | Thu / chi / lãi theo tháng × mảng + công nợ + pipeline. `months` 1–24 (mặc định 12, ngoài khoảng → 400), tính cả tháng hiện tại theo giờ VN (`FinanceClock`) |
| GET | `/api/projects/financials/alerts` | `ProjectViewer.FinanceView` (như `/financials`) | Dự án **đang chạy** cần chú ý: lỗ / vượt / sắp vượt ngân sách ngày công |

Hai route tách riêng vì tính nhân công dự án chậm — giao diện gọi song song, `/alerts` không chặn `/dashboard`.

### `/finance/dashboard` → `FinanceDashboardDto`

- `from` (ngày đầu tháng đầu), `today` (giờ VN), `months`.
- `monthly[]` — **đủ `months` dòng, cũ → mới**, tháng không có giao dịch = 0: `month`, `income`, `expense`, `profit` (= thu − chi), `byLine[]` (`LineSummary`: `businessLineId` — null = "Chưa gắn mảng", `name`, `income`, `expense`; chỉ mảng có phát sinh, nhiều tiền trước).
- `totals` — cộng mọi tháng: `income`, `expense`, `profit`, `byLine[]`.
- Số theo **tiền thực thu / thực chi của sổ quản trị** (`finance.entries`), **không phải doanh thu ghi nhận** (hợp đồng ký chưa thu không vào). Chỉ dòng còn hiệu lực, **không tính chuyển quỹ** — cùng quy tắc với `/overview`. Gộp tháng × mảng là hàm thuần `DashboardRules.Monthly` (unit test).
- `receivables` (`ISalesOutlook.ReceivablesAsync`, toàn công ty): `outstanding` (còn phải thu), `overdue`, `overdueCount` (số đợt quá hạn), `dueSoon` (≤ 7 ngày), `aging[]` luôn đủ 4 nhóm `1-30` · `31-60` · `61-90` · `>90` (`bucket`, `amount`, `count`). **Khớp `GET /api/sales/receivables`** của người có Xem tài chính: HĐ đang hiệu lực, đợt chưa huỷ, chưa thu đủ; đã thu qua `CollectedCalculator` (chỉ lần thu còn dòng sổ), trạng thái / tuổi nợ qua `SalesRules`.
- `pipeline` (`ISalesOutlook.PipelineAsync`): cơ hội đang mở (không Thắng / Thua) — `openCount`, `openValue`, `weighted` (Σ `SalesRules.Weighted` = giá trị × xác suất), `byStage[]` luôn đủ `Lead` · `Contacted` · `Quoted` · `Negotiating` (`count`, `value`, `weighted`). Khớp tổng `weighted` của `/api/sales/opportunities` (cơ hội đã đóng = 0).

### `/projects/financials/alerts` → `ProjectAlertDto[]`

- Dùng lại `ProjectFinance.ComputeAsync` (không chi tiết theo người) cho mọi dự án `Active`; dự án đã đóng không ra.
- Cờ (`ProjectCostRules.Alerts`, unit test): `loss` = lãi < 0 · `overBudget` = ngày công > ngân sách · `nearBudget` = ngày công ≥ **80 %** ngân sách và chưa vượt (`NearBudgetPercent`). Không có ngân sách (null / ≤ 0) → không có cờ ngân sách. Chỉ trả dự án có ít nhất một cờ, **lãi thấp nhất trước**.
- Mỗi dòng: `projectId`, `code`, `name`, `kind`, `revenue`, `profit`, `marginPercent`, `manDays`, `budgetManDays`, `budgetUsedPercent` (1 chữ số, không ngân sách → null), `hasEstimate` (có tháng nhân công ước tính), `loss`, `overBudget`, `nearBudget`. Không có `months` / `categories` / `people`.
- Lưu ý: dự án **nội bộ** không có doanh thu → có chi phí nhân công / chi trực tiếp là `loss`; giao diện dựa vào `kind` để trình bày.

## Giao diện (TEST-223)

`frontend/src/features/finance/` — FE **chỉ hiển thị** số API trả, không tự tính dự báo / quyền (nút sửa theo `useFinancePerms().admin`). Chỉ người có quyền Xem thấy 2 tab; người khác chỉ "Đề nghị chi" và **không gọi** các API này.

- **Tổng quan** (`overview-tab`, mặc định): 7 thẻ số (`/overview` + `/dashboard`). `month-flow-chart`: cột thu – chi + đường lãi 12 tháng + bảng số (mới → cũ, dòng Cộng). `line-month-card`: theo mảng, chọn tháng (mặc định tháng này). `receivables-card` (tuổi nợ 4 nhóm → `/sales?tab=receivables`), `pipeline-card` (theo giai đoạn → `/sales?tab=opportunities`), `project-alerts-card` (tải riêng `/api/projects/financials/alerts`, nhãn Lỗ / Vượt ngân sách / Sắp vượt → `/projects/<id>?tab=finance`; rỗng → "Không có dự án cần chú ý"), bảng quỹ.
- **Dự báo** (`?tab=forecast`, `forecast-tab`): dòng cảnh báo "Thận trọng / Kỳ vọng: âm tiền từ tuần N (ngày)" (`firstNegative*`), `forecast-chart` (2 đường số dư cuối tuần, vạch 0), `forecast-table` (13 cột tuần; dòng theo `FORECAST_LINES` ở `utils/labels.ts` — dòng ra dấu −, dòng chỉ thuộc Kỳ vọng có nhãn; ô âm destructive; cột tên dính, bảng cuộn ngang trong khung), bấm ô có tiền → `forecast-cell-sheet` (`items` theo tuần + dòng, có link; lương chỉ tổng). Ghi chú giả định dưới bảng (ngày trả lương, số ngày trễ, `undated*`, kỳ lương đã qua coi như đã chi).
- **Quản trị tài chính**: nút "Cấu hình dự báo" (`forecast-settings-dialog`: ngày trả lương, số ngày trễ) và "Khoản định kỳ" (`recurring-items-dialog` + `recurring-item-form-dialog`: thêm / sửa / ngừng, không xoá) trên hàng tab (`PageToolbar`). Lỗi server hiện theo field; lưu xong làm mới `['finance']` → dự báo tự cập nhật.
- Biểu đồ: **SVG thuần** (FE không có thư viện biểu đồ), vẽ theo bề ngang thật (`hooks/useElementWidth.ts`, thang trục `utils/chart.ts`), màu token (`success`, `destructive`, `primary`, `chart-1/2`) → sáng / tối; rê chuột / Tab → dòng giá trị phía trên. Khung bọc phải `grid-cols-1` + `min-w-0` (track `auto` sẽ nở theo SVG và tràn thẻ ở 375 px).
- Mỗi khối tự xử lý đang tải (skeleton) / lỗi (`block-state`, nút Thử lại) / rỗng — một API lỗi không làm trắng cả tab.
- e2e: `scripts/dev/finance-dashboard-ui-e2e.ts` (Chrome headless, DB tạm) — [e2e.md](../e2e.md).

## Ranh giới module

- Finance tham chiếu thêm `OfficeHub.Modules.Sales.Contracts` (Sales đã tham chiếu `Finance.Contracts`; hai project Contracts không tham chiếu nhau → không vòng).
- `ISalesOutlook` **CÓ SỐ TIỀN**, toàn công ty (không lọc người phụ trách): chỉ gọi sau khi đã kiểm tra quyền Xem tài chính. Việc 2/3 đã thêm `OpenInstallmentsAsync` / `OpenOpportunitiesAsync` (từng đợt / cơ hội, cho dự báo) — [finance-forecast.md](finance-forecast.md).

## Kiểm thử

- Unit: `Finance.Tests/DashboardRulesTests`, `Sales.Tests/SalesOutlookRulesTests`, `Projects.Tests/ProjectCostRulesTests` (Alerts, BudgetUsedPercent).
- e2e: `scripts/dev/finance-dashboard-e2e.ts` (DB tạm, so phần chênh trước / sau → chạy lại được) — [e2e.md](../e2e.md).
