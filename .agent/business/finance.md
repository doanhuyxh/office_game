# Tài chính: sổ thu chi + đề nghị chi (module Finance)

> Nguồn sự thật là code (`backend/src/Modules/Finance/`, `frontend/src/features/finance/`); nếu code khác tài liệu, tin code và sửa tài liệu. Kế hoạch tổng (Kinh doanh / Dự án / Affiliate…): [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md). Về [README.md](README.md).

Chủ dự án chốt 2026-11-08: **chỉ giám đốc + kế toán xem tiền, cấu hình theo chức vụ**; công ty **không dùng phần mềm kế toán** → có sổ thu chi nội bộ; **mọi khoản chi đều phải duyệt**; **chỉ VND** (USD tự quy đổi). Đây là **sổ quản trị** — không phát hành hoá đơn điện tử, không thay sổ sách / báo cáo thuế theo luật. **Chứng từ đính kèm + Excel** (sổ thu chi, sổ quỹ, tổng hợp): [finance-docs.md](finance-docs.md).

## Quyền (theo chức vụ, không theo vai trò)

Bit trên `org.positions.FinancePermissions` — cấu hình + ai được đổi: [organization.md](organization.md) (mục Phòng ban & chức vụ). Kiểm tra bằng `IFinanceAccess` (Organization.Contracts) qua endpoint filter `RequireFinance(...)` (`Infrastructure/FinanceServices.cs`). **Vai trò admin / hr không thay thế** — admin seed (không hồ sơ) không xem được tiền.

| Quyền | Được |
|---|---|
| Xem (1) | `/overview`, `/accounts`, `/entries`, `/lock`, `/expenses?scope=all` |
| Ghi sổ (2) | ghi / huỷ giao dịch, "Đã chi" đề nghị đã duyệt |
| Duyệt chi (4) | bước `Finance` của luồng duyệt (module Approval) |
| Quản trị (8) | quỹ, mảng, danh mục, khoá sổ; đổi quyền tài chính trên chức vụ |

Ghi / Duyệt / Quản trị **bao hàm Xem**. Mọi người đăng nhập đọc được `/lines`, `/categories` (form đề nghị chi) và gửi / xem đề nghị chi **của mình**.

## API (`/api/finance`, đăng nhập)

| Method | Path | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/overview` | Xem | Tổng số dư quỹ đang dùng, thu / chi **tháng này** theo mảng (không tính chuyển quỹ), số + tiền đề nghị chờ duyệt / chờ chi, `lockedThrough` |
| GET/POST/PUT | `/accounts[/{id}]` | Xem / Quản trị | Số dư tính khi đọc. Tên duy nhất; `last4` đúng 4 số. **Đổi số dư / ngày đầu kỳ khi quỹ đã có giao dịch → 409** |
| GET/POST/PUT | `/lines`, `/categories` | ai cũng đọc / Quản trị | Mã mảng viết hoa, duy nhất. Danh mục (`Kind` Thu / Chi) duy nhất theo loại; đã có giao dịch thì không đổi loại (409) |
| GET/PUT | `/lock` | Xem / Quản trị | `{ lockedThrough }` — khoá đến hết ngày đó (không ở tương lai); `null` = mở khoá |
| GET | `/entries?from&to&kind&accountId&lineId&categoryId&voided&search&page&pageSize` | Xem | Luôn phân trang; mặc định chỉ dòng còn hiệu lực, `voided=true` = dòng đã huỷ; `search` ILIKE diễn giải / đối tác / số HĐ |
| POST | `/entries` | Ghi sổ | `{ kind: Income/Expense/Transfer, date, amount, accountId, toAccountId?, categoryId?, businessLineId?, counterparty?, description?, invoiceNumber? }` |
| POST | `/entries/{id}/void` | Ghi sổ | `{ reason }` bắt buộc. Đã huỷ → 409; trong kỳ khoá → 409 |
| GET | `/expenses?scope=mine\|all&status&page` | đăng nhập / Xem (all) | |
| POST | `/expenses` | có hồ sơ nhân viên | `{ amount, reason, payee?, categoryId? (loại Chi), businessLineId?, neededBy? (≥ hôm nay) }` → gửi duyệt |
| POST | `/expenses/{id}/pay` | Ghi sổ | `{ accountId, date, invoiceNumber? }` → sinh dòng chi |

Token AI (TEST-78, chủ dự án chốt 2026-11-13 — giai đoạn đầu **chỉ đọc**): chỉ `GET /overview`, `/accounts`, `/lines`, `/categories`, `/lock`, `/entries`, `/expenses` (tool MCP nhóm Tài chính — [mcp.md](mcp.md)); quyền vẫn theo chức vụ như trên web (không Xem → 403). Mọi POST / PUT (ghi / huỷ dòng, tạo / chi đề nghị, quỹ, mảng, danh mục, khoá sổ), `entries/export.xlsx`, `/attachments*`, `/projects` → 403. **Tài khoản bot kế toán**: HR chỉ gán chức vụ có quyền **Xem** (không Ghi sổ / Duyệt chi / Quản trị) — dù có bit ghi, token vẫn không gọi được route ghi.

**Cho module khác** (`OfficeHub.Modules.Finance.Contracts`): `IFinanceLedger.RecordIncomeAsync(LedgerIncome)` ghi một dòng THU (cùng `ValidateAsync` với màn ghi sổ; lỗi trả theo field, không ném; một nguồn chỉ một dòng hiệu lực) và `ActiveSourcesAsync(sourceType, ids)` cho biết dòng nào còn hiệu lực. Đang dùng: Sales ghi nhận thu (`sales_collection`) — [sales.md](sales.md). `ProjectTotalsAsync` (thu / chi gắn dự án theo tháng × danh mục) cho lãi / lỗ dự án. **Gắn dự án** (`ProjectId` trên dòng sổ + đề nghị chi, `GET /projects`, `/entries?projectId=`): [projects-finance.md](projects-finance.md).

## Quy tắc (`Domain/LedgerRules.cs`, test `tests/OfficeHub.Modules.Finance.Tests`)

- Tiền `long` VND, 1 … 10 nghìn tỷ. Ngày giao dịch ≤ hôm nay (giờ VN), > ngày khoá sổ, ≥ ngày đầu kỳ của quỹ (gửi và nhận).
- Chuyển quỹ: có quỹ nhận ≠ quỹ gửi, không danh mục. Thu / chi: không quỹ nhận; danh mục cùng loại.
- Số dư = đầu kỳ + thu − chi − chuyển đi + chuyển đến (dòng đã huỷ không tính) — `LedgerRules.Effect` và SQL `FinanceQueries.AccountsAsync` phải khớp.
- **Không xoá** dòng sổ: huỷ kèm lý do (người huỷ, lúc huỷ). Quỹ / mảng / danh mục không xoá — chỉ ngừng (`IsActive`); quỹ đã đóng không ghi thêm.
- Số tiền **không** gắn `[Audited]` (màn "Lịch sử thay đổi" HR cũng xem): chỉ `BusinessLine`, `TxCategory`, `FinanceSettings` có audit. Dấu vết dòng sổ nằm ngay trên dòng (người ghi, người huỷ, lý do).

## Đề nghị chi

1. Nhân viên gửi → `Pending`, mã `CP-00001` (cột identity), gửi Approval loại `expense_request`, bước `[Manager, Finance]` ([approval.md](approval.md)). Không có quản lý → chỉ bước Finance. Lỗi gửi duyệt → xoá đề nghị.
2. Duyệt hết → handler `ExpenseApprovalHandler` (idempotent) → `Approved` + chuông `expense_ready` cho người có quyền Ghi sổ. Từ chối → `Rejected` + `RejectReason`; người gửi huỷ ở Phê duyệt → `Cancelled`.
3. Kế toán "Chi tiền" → dòng chi (`SourceType = "expense_request"`, `SourceId`) + `Paid` + chuông `expense_paid` cho người gửi. Index duy nhất `ux_entries_source` (khi `Status = Active`) → bấm hai lần / hai người cùng bấm chỉ ghi một (409).
4. Huỷ dòng chi đó → đề nghị về `Approved`, chi lại được.

**Không tự duyệt** (luật chung Approval) kể cả khi có quyền Duyệt chi. ⚠ Nếu **chỉ một người** có quyền Duyệt chi mà chính người đó gửi đề nghị (và không có quản lý) → đơn không ai duyệt được: cần ≥ 2 chức vụ có Duyệt chi (hiện Giám đốc + Kế toán trưởng). Đơn có bước Finance **ẩn với token AI** (không duyệt / huỷ qua MCP).

## Schema `finance` (`FinanceDbContext`, migration `InitialFinance`)

`business_lines` (Code unique), `accounts` (Name unique, `Kind` Cash/Bank, `Last4`, `OpeningBalance`, `OpeningDate`), `categories` (unique `Kind`+`Name`), `entries` (FK quỹ / danh mục / mảng Restrict; index `Date`, `AccountId`; `ux_entries_source`), `expense_requests` (`Number` identity unique; index requester, status), `settings` (một dòng Id = 1, `LockedThrough`). `FinanceMigrator` seed **khi bảng trống**: 4 mảng (CHUNG, OUTSOURCE, AFFILIATE, KENH-MXH) + 4 danh mục thu + 10 danh mục chi. Quỹ do Quản trị tài chính tự tạo.

## UI (`/finance`, menu "Tài chính" mọi người thấy)

`FinancePage`: người có quyền Xem → Tổng quan · Sổ thu chi · Đề nghị chi (Của tôi / Tất cả) · Cấu hình (chỉ Quản trị sửa được); người khác chỉ "Đề nghị chi". Nút trên hàng tab: "Ghi giao dịch" (Ghi sổ), "Đề nghị chi". Ô tiền nhập có dấu chấm nghìn (`parseMoney`).

## Chưa làm

Chứng từ đính kèm (S3), xuất Excel sổ, đối soát sao kê, sinh đề nghị chi từ kỳ lương, bắt buộc 2FA cho người có quyền tài chính, thông báo khi đổi quyền. Khách hàng + hợp đồng bán + công nợ: [sales.md](sales.md).
