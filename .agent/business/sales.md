# Kinh doanh: khách hàng, cơ hội, hợp đồng bán, công nợ (module Sales)

> Nguồn sự thật là code (`backend/src/Modules/Sales/`, `frontend/src/features/sales/`); nếu code khác tài liệu, tin code và sửa tài liệu. Kế hoạch: [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md) giai đoạn 1. Sổ thu chi: [finance.md](finance.md). Về [README.md](README.md).

Dùng cho mảng **Outsource** và **Xây kênh MXH thuê** (có khách, hợp đồng, đợt thu). Chỉ VND. Chưa có: báo giá (mẫu Word) + duyệt giảm giá, gắn file hợp đồng đã ký, tool MCP. **Phụ lục** tăng / giảm giá trị (từ yêu cầu thay đổi của dự án): [projects-changes.md](projects-changes.md).

## Ai thấy gì (`Infrastructure/SalesServices.cs` → `SalesAccess` / `SalesViewer`)

Theo **người phụ trách** (`OwnerEmployeeId`) — không theo vai trò admin / hr (chủ dự án chốt 2026-11-08):

| Người xem | Thấy | Sửa |
|---|---|---|
| Nhân viên | khách / cơ hội / hợp đồng / công nợ **mình phụ trách** (kể cả số tiền) | của mình |
| Quản lý | của mình + **cấp dưới** (trực tiếp / gián tiếp, `GetSubordinateIdsAsync`) | như thấy |
| Quyền tài chính **Xem** (chức vụ) | tất cả | không (trừ khi có **Quản trị**) |
| Quyền **Quản trị** tài chính | tất cả | tất cả |
| Tài khoản không có hồ sơ (admin seed) | không gì (không tạo được khách → 403) | — |

Nghiệm thu mốc dự án gắn đợt thu → `ISalesContractsLookup.MarkAcceptedAsync` (Sales.Contracts) kéo hạn đợt về ngày nghiệm thu + báo — [projects.md](projects.md). Một dự án có nhiều HĐ, một HĐ chỉ một dự án; `ISalesRevenueLookup` (có tiền, chỉ sau kiểm tra quyền) cho lãi / lỗ dự án — [projects-finance.md](projects-finance.md).

Không thấy → **404** (không lộ sự tồn tại). Thấy nhưng không sửa → 403. **Ghi nhận thu** chỉ người có quyền **Ghi sổ**. Giao người phụ trách: chỉ cho chính mình / cấp dưới (hoặc Quản trị tài chính) — sai → 400 `ownerEmployeeId`. Token AI: `/api/sales/*` ngoài allowlist → 403.

## API (`/api/sales`, đăng nhập)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/customers?search&ownerId&includeInactive&page` | Luôn phân trang. `search` ILIKE tên / MST / điện thoại / email / tên + điện thoại người liên hệ. Kèm số cơ hội mở, HĐ hiệu lực |
| GET | `/customers/{id}` | Khách + liên hệ + 100 chăm sóc gần nhất + cơ hội + hợp đồng (có số đã thu) + `canEdit` |
| POST / PUT | `/customers[/{id}]` | `{ name, kind: Company/Individual, taxCode?, address?, phone?, email?, source?, note?, ownerEmployeeId?, isActive }`. Mã `KH-00001` (identity). **MST trùng → 400** kèm mã khách cũ. Email lưu chữ thường. Không xoá — `isActive = false` |
| POST / PUT / DELETE | `/customers/{id}/contacts`, `/contacts/{id}` | Liên hệ đầu tiên tự là chính; đặt `isPrimary` → bỏ chính ở người khác |
| POST | `/customers/{id}/activities` | `{ kind: Call/Meeting/Email/Message/Note, content, at?, opportunityId?, nextAction?, nextActionOn? }` — hẹn ngày phải có việc |
| GET | `/activities/upcoming` | Việc tôi đã hẹn (từ 30 ngày trước) |
| GET / POST / PUT | `/opportunities[/{id}]` | Tối đa 500, không phân trang. `probability` null = mặc định theo giai đoạn (Tiềm năng 10 · Đã liên hệ 20 · Đã báo giá 40 · Đàm phán 70 · Thắng 100 · Thua 0). **Thua cần `lostReason`**. Không đổi khách của cơ hội |
| GET | `/contracts?customerId&status&search&page` | Kèm `scheduled` / `collected` / `outstanding` / `overdue` |
| GET | `/contracts/{id}` | Đợt thu + lịch sử thu (`active` = dòng sổ còn hiệu lực) + `canEdit`, `canCollect` |
| POST | `/contracts` | `{ code (duy nhất), customerId, title, valueBeforeTax, vatRate ∈ 0/5/8/10, signedOn (≤ hôm nay), billing: Milestone/Monthly/OneTime, installments[{title, dueOn, amount}], endOn?, opportunityId?, businessLineId?, note? }`. Từ cơ hội → cơ hội **Thắng** |
| PUT | `/contracts/{id}` | `{ title, status: Active/Completed/Cancelled, endOn?, note? }` — **không** đổi giá trị (dùng phụ lục) |
| POST | `/contracts/{id}/installments` | Chỉ HĐ Active; tổng đợt (không huỷ) ≤ giá trị sau thuế |
| POST | `/installments/{id}/cancel` | `{ reason }` bắt buộc; đợt đã có tiền thu (dòng sổ hiệu lực) → 409 |
| POST | `/installments/{id}/collect` | **Ghi sổ**. `{ amount (≤ còn lại), date, accountId, categoryId?, invoiceNumber? }` → dòng THU ở Finance |
| GET | `/receivables?state&ownerId&customerId` | Đợt chưa thu đủ của HĐ Active (tối đa 1000) + tổng còn phải thu / quá hạn / sắp đến hạn + tuổi nợ 1-30 / 31-60 / 61-90 / >90 |

## Quy tắc (`Domain/SalesRules.cs`, test `tests/OfficeHub.Modules.Sales.Tests`)

- Giá trị sau thuế = trước thuế + làm tròn(trước thuế × VAT %).
- Lịch thu: theo mốc / một lần → **tổng = giá trị sau thuế** (một lần → đúng 1 đợt); hằng tháng → tổng **≤** giá trị. Mỗi đợt có tên, tiền > 0, hạn ≥ ngày ký; ≤ 120 đợt. FE "Tạo lịch" hằng tháng: cùng ngày mỗi tháng, tháng ngắn → ngày cuối tháng (`MonthlySchedule`).
- Trạng thái đợt (tính khi đọc): Huỷ → Đã thu (đủ) → **Quá hạn** (hạn < hôm nay, kể cả đã thu một phần) → Thu một phần → Sắp đến hạn (≤ 7 ngày) → Chưa đến hạn.
- **Số đã thu = tổng các lần thu mà dòng sổ Finance còn hiệu lực** (`CollectedCalculator` → `IFinanceLedger.ActiveSourcesAsync("sales_collection", …)`). Kế toán huỷ dòng ở sổ → đợt tự về chưa thu, không cần sự kiện.
- Ghi nhận thu: lưu `Collection` trước → `IFinanceLedger.RecordIncomeAsync` (SourceId = Id lần thu, cùng kiểm tra với màn ghi sổ: quỹ đóng, kỳ khoá, ngày tương lai…) → gắn `LedgerEntryId`. Ghi sổ lỗi → xoá lần thu, trả lỗi theo field của sổ (`date`, `accountId`…). Dòng THU: đối tác = tên khách, diễn giải `Thu HĐ {số} – {đợt}`, mảng = mảng của HĐ.

## Nhắc (`SalesReminderJob`, mỗi giờ, sau 40 s khởi động)

Đợt chưa thu đủ của HĐ Active → người phụ trách HĐ + người có quyền Ghi sổ, category `receivable_due`, link `/sales?tab=receivables`: **sắp đến hạn** (≤ 7 ngày, một lần, chỉ chuông) · **đến hạn hôm nay** (một lần, + email) · **quá hạn** (lần đầu phát hiện, sau đó mỗi thứ Hai; + email). Mốc đã nhắc lưu trên đợt (`RemindedSoonAt`, `RemindedDueAt`, `LastOverdueRemindOn`). Việc chăm sóc đến hẹn → người ghi, `customer_follow_up`, chỉ chuông, một lần.

## Schema `sales` (`SalesDbContext`, migration `InitialSales`)

`customers` (`Number` identity unique, `TaxCode` unique khi có, index owner), `contacts` (cascade theo khách), `activities` (index khách + thời điểm, ngày hẹn), `opportunities`, `contracts` (`Code` unique, index khách / owner), `installments` (index hạn), `collections` (`LedgerEntryId` = Id dòng sổ ở schema `finance` — không FK chéo schema). Không `[Audited]` trên số tiền (màn "Lịch sử thay đổi" HR cũng xem); chỉ `Customer` có audit.

## UI (`/sales`, menu "Kinh doanh")

`SalesPage`: Khách hàng (việc hẹn sắp tới / quá hẹn, tìm, sheet chi tiết: liên hệ, chăm sóc, cơ hội, hợp đồng) · Cơ hội (4 cột giai đoạn mở + tổng có trọng số, đã đóng gần đây) · Hợp đồng (sheet: thẻ giá trị / đã thu / còn nợ, đợt thu + lịch sử thu, Thu tiền, huỷ / thêm đợt, đổi trạng thái) · Công nợ (tổng + tuổi nợ, lọc). `?customer=<id>` mở thẳng khách (link thông báo).
