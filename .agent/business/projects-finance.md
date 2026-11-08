# Dự án: hợp đồng, chi phí nhân công, lãi / lỗ (Projects giai đoạn 2b)

> Nguồn sự thật là code (`backend/src/Modules/Projects/` — `Domain/ProjectCostRules.cs`, `Infrastructure/ProjectCosts.cs`; FE `features/projects/components/{financials-panel,profit-table}`). Phần chung của dự án: [projects.md](projects.md). Kế hoạch: [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md) §4. Về [README.md](README.md).

Chủ dự án chốt 2026-11-08:

1. **Doanh thu = giá trị hợp đồng SAU thuế**; VAT là **một dòng chi phí**.
2. **Một dự án có nhiều hợp đồng bán; một hợp đồng chỉ thuộc một dự án.**
3. **Tự chốt % phân bổ** đầu tháng sau (xem dưới).
4. Lãi / lỗ dự án **không** gánh chi phí chung (BGĐ, HR, văn phòng…).
5. Quản lý dự án chỉ thấy ngày công, **không** thấy tiền.

## Hợp đồng của dự án

Bảng `projects.contracts` (PK dự án + hợp đồng, **unique `ContractId`**) thay cột cũ `projects.SalesContractId` (migration `ProjectContractsAndFreeze` chép dữ liệu cũ trước khi xoá cột; hợp đồng cũ gắn nhiều dự án → giữ dự án tạo sớm nhất).

- `POST/PUT /api/projects` nhận `salesContractIds: Guid[]` (thay `salesContractId`). Dự án cho khách cần ≥ 1; nội bộ → bỏ hết. Hợp đồng đã ở dự án khác → 400 `salesContractIds`.
- Bỏ một hợp đồng mà mốc của dự án đang gắn đợt thu của nó → 400 (đổi / bỏ đợt thu ở mốc trước). Đổi Client → Internal cũng vậy.
- `ProjectDto.contracts: SalesContractRef[]` (không tiền). `GET /api/projects/{id}/installments` — đợt thu của mọi hợp đồng của dự án (không tiền; người không thấy dự án → 404). Mốc chỉ gắn được đợt thu thuộc các hợp đồng này.

## Ngày công + chốt phân bổ (`EffortCalculator`)

- Tháng **chưa chốt**: thành viên hiện tại + ai có dòng % đặt tay; % mặc định chia đều theo số dự án đang chạy (như [projects.md](projects.md)).
- `AllocationFreezeJob` (mỗi giờ, sau 70 s): nếu tháng trước chưa chốt → ghi % mặc định thành dòng `allocations` (Percent `numeric(5,2)`, vd 33,33) cho mọi thành viên của dự án chạy trong tháng đó + dòng `allocation_freezes(Month, FrozenAt)`.
- Tháng **đã chốt** (với dự án tạo trước lúc chốt): **chỉ** dòng % đã lưu được tính → thêm / bỏ thành viên về sau không đổi số liệu; người đã rời vẫn hiện "(đã rời dự án)" ở tháng đó. Dự án tạo sau lúc chốt mà ngày bắt đầu lùi về tháng đó → tính như tháng chưa chốt.
- `PUT /{id}/allocations` tháng đã chốt: **chỉ HR hoặc Quản trị tài chính** (kể cả khi không quản lý dự án); tháng chưa chốt: quản lý dự án / HR. `percent` nhận số lẻ (≤ 2 chữ số).
- `GET /{id}/effort` thêm `frozenMonths`, `canEditFrozen`.

## Chi phí nhân công (`ProjectCostRules.LaborCost`)

`nhân công(A, P, M) = chi phí công ty cho A tháng M × % phân bổ A vào P` (= chi phí × công ở P / công thực tế). Không có ngày có mặt trong tháng → 0 (thuộc chi phí chung). Tổng % < 100 → phần còn lại là chi phí chung.

Chi phí công ty lấy từ **`Payroll.Contracts.IPayrollCosts`** = `EmployerCost` của phiếu = Gross + BH phần công ty (không gồm khoản cộng / trừ không chịu thuế như tạm ứng):
- Kỳ lương **đã chốt** → phiếu đã lưu (cố định).
- **Tháng đang chạy** → `PayrollService.BuildAsync(assumeFullAttendance: true)`: lương hợp đồng **đủ công chuẩn** + BH (không để ngày chưa tới bị tính "không hưởng lương" → mất BH) → cờ `Estimated`.
- Tháng đã qua mà chưa chốt → tính như bảng lương (chấm công thật, gồm khoản cộng / trừ của kỳ Draft nếu có) → `Estimated`. UI ghi "ước tính".

## Thu / chi trực tiếp (module Finance)

- `finance.entries.ProjectId`, `finance.expense_requests.ProjectId` (nullable, không FK chéo schema; migration `AddProjectToEntries`). Chuyển quỹ không gắn dự án (400). Dự án đã đóng vẫn ghi được.
- Đề nghị chi gắn dự án: người gửi phải là thành viên dự án (hoặc có Xem tài chính); "Đã chi" → dòng chi mang theo dự án.
- `GET /api/finance/projects` — dự án để chọn (Xem tài chính: mọi dự án đang chạy; người khác: dự án mình tham gia). `GET /entries?projectId=`.
- `IFinanceLedger.ProjectTotalsAsync` gộp dự án × tháng × thu/chi × danh mục (dòng còn hiệu lực). Thu của khách qua Sales (`sales_collection`) **không** gắn dự án → không bị tính hai lần.

## Doanh thu (`Sales.Contracts.ISalesRevenueLookup`)

Chỉ gọi sau khi kiểm tra quyền. Mỗi hợp đồng: trước / sau thuế, VAT %, đã thu (lần thu còn dòng sổ hiệu lực) + ngày thu. Hợp đồng **đã huỷ**: doanh thu = số đã thu, VAT theo tỉ lệ, còn nợ = 0.

`Lãi = doanh thu − VAT + thu khác − nhân công − chi trực tiếp`; biên = lãi / (doanh thu + thu khác), 1 chữ số thập phân; chưa có thu → null.

## API (`/api/projects`)

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/{id}/financials` | **Xem tài chính** (quản lý dự án / thành viên 403, người không thấy dự án 404) | Tổng + hợp đồng + theo tháng (ngày công, nhân công, ước tính?, chi trực tiếp, thu khác, khách đã trả) + danh mục. `people` (nhân công theo người) **chỉ Quản trị tài chính**, người khác `null` |
| GET | `/financials?status` | Xem tài chính | Mọi dự án, bỏ `months` / `categories` / `people` |

Tính khi đọc (24 tháng gần nhất như ngày công), không lưu số tiền. Token AI: `/api/projects` ngoài allowlist → 403. Không có tool MCP.

## UI

- Trang dự án → tab **Tài chính** (chỉ Xem tài chính): 6 thẻ (doanh thu, VAT, nhân công, chi trực tiếp, lãi / lỗ + biên, đã thu / còn nợ), bảng hợp đồng, bảng theo tháng, chi theo danh mục, nhân công theo người (Quản trị tài chính).
- `/projects` → tab **Lãi / lỗ** (chỉ Xem tài chính): mọi dự án sắp lỗ trước, cờ "Vượt" ngân sách ngày công, dòng tổng; bấm → tab Tài chính.
- Form dự án: chọn nhiều hợp đồng. Tab Ngày công: 🔒 tháng đã chốt. Form ghi sổ / đề nghị chi: ô "Dự án"; sổ + danh sách đề nghị chi hiện tên dự án.

E2E: `scripts/dev/projects-cost-e2e.ts a|b` ([e2e.md](../e2e.md)).

## Chưa làm (giai đoạn 2b-2)

Yêu cầu thay đổi (CR) → phụ lục hợp đồng bán (Sales chưa có phụ lục) → đợt thu mới, tăng ngân sách ngày công.
