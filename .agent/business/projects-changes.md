# Yêu cầu thay đổi (CR) + phụ lục hợp đồng bán (giai đoạn 2b-2)

> Nguồn sự thật là code: Projects `Domain/ChangeRequestRules.cs`, `Features/ChangeRequestEndpoints.cs`; Sales `Features/AppendixEndpoints.cs`, `SalesRules.ValidateAppendix`; FE `features/projects/components/change-requests-panel`, `features/sales/components/appendix-dialog`. Phần chung: [projects.md](projects.md) · tiền / lãi lỗ: [projects-finance.md](projects-finance.md) · hợp đồng bán: [sales.md](sales.md). Về [README.md](README.md).

Luồng: quản lý dự án ghi **CR** (phần việc + ngày công ước tính, **không nhập tiền**) → khách đồng ý → cộng ngày công vào ngân sách; nếu **tính tiền** → chuông cho người phụ trách hợp đồng + người có quyền Ghi sổ → họ lập **phụ lục** ở hợp đồng bán (nhập tiền) → giá trị hợp đồng + lãi / lỗ dự án tự cập nhật.

## CR (module Projects, bảng `projects.change_requests`, `[Audited]`)

- Mã `{MÃ DỰ ÁN}-CR{n}` (n tăng trong dự án, unique; tạo đồng thời → thử số kế).
- Trạng thái (`ChangeRequestRules.CanMove`): Nháp → Đã gửi / Khách đồng ý (đồng ý miệng) / Từ chối / Huỷ; Đã gửi → Nháp / Đồng ý / Từ chối / Huỷ. **Đồng ý / Từ chối / Huỷ là cuối** (không sửa, không huỷ — đã cộng ngân sách, có thể đã có phụ lục). Sửa nội dung chỉ khi Nháp / Đã gửi.
- Khách đồng ý: `decidedOn` ≤ hôm nay (mặc định hôm nay). Dự án **có** ngân sách + CR có ước tính > 0 → `BudgetManDays += ước tính`, lưu `BudgetAddedManDays`. Dự án không đặt ngân sách → không cộng.
- `billable = true` cần dự án đã gắn hợp đồng bán (400 `billable`). Đồng ý + tính tiền → `ISalesContractsLookup.NotifyChangeRequestApprovedAsync` → chuông `change_request_approved` (người phụ trách các HĐ đang hiệu lực của dự án + quyền Ghi sổ), link `/sales?customer=…`.
- Quyền: thấy = ai thấy dự án; tạo / sửa / đổi trạng thái = quản lý dự án / HR, dự án đang chạy (đóng → 409).

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/projects/{id}/change-requests` | Mới trước. `appendix` = phụ lục còn hiệu lực lập từ CR (số, HĐ, ngày ký — **không tiền**, qua `AppendicesOfChangeRequestsAsync`) |
| POST / PUT | `/{id}/change-requests`, `/change-requests/{cid}` | `{ title ≤ 300, description? ≤ 5000, estimateManDays? (0–100 000), billable }` |
| POST | `/change-requests/{cid}/status` | `{ status, decidedOn?, note? ≤ 1000 }` |

`IProjectDirectory.ChangeRequestsForContractAsync(contractId)` — mọi CR của dự án sở hữu hợp đồng (Sales dùng để chọn / hiển thị).

## Phụ lục (module Sales, bảng `sales.contract_appendices`)

- `{ code (≤ 50, duy nhất trong HĐ), title, signedOn (≥ ngày ký HĐ, ≤ hôm nay), valueBeforeTaxDelta (≠ 0, âm = giảm), installments[]?, changeRequestId?, note? }`. VAT theo **thuế suất của hợp đồng**: `totalDelta = Total(delta, VatRate)`.
- Lập → `contracts.ValueBeforeTax += delta`, `TotalValue += totalDelta` (giá trị trên HĐ luôn là **hiện tại**; gốc = hiện tại − tổng phụ lục còn hiệu lực). Đợt thu mới có `installments.AppendixId`.
- Tăng: đợt mới cộng lại ≤ phần tăng (thêm sau bằng "Thêm đợt thu" cũng được). Giảm: không kèm đợt; giá trị mới ≥ tổng đợt đang lên lịch (huỷ bớt đợt trước) và trước thuế còn ≥ 1.
- `changeRequestId`: CR **Khách đồng ý + tính tiền** của dự án sở hữu HĐ, chưa có phụ lục còn hiệu lực (index unique lọc `NOT Cancelled`) — sai → 400.
- Huỷ (`POST /api/sales/appendices/{id}/cancel { reason }`): đợt của phụ lục chưa có tiền thu (dòng sổ hiệu lực) → huỷ các đợt đó + trừ lại giá trị; giá trị mới phải ≥ các đợt còn lại (409). CR của nó trở lại "chờ lập phụ lục".
- Quyền như sửa hợp đồng (người phụ trách / quản lý của họ / HR — `SalesViewer.CanEdit`); HĐ không còn hiệu lực → 409.
- `GET /api/sales/contracts/{id}` thêm `originalValueBeforeTax`, `originalTotalValue`, `appendices[]` (kèm `changeRequestCode`), `pendingChangeRequests[]` (chỉ người sửa được, HĐ đang hiệu lực).

## UI

- Dự án → tab **Thay đổi**: danh sách CR (trạng thái, tính tiền, ngày công, đã cộng ngân sách, phụ lục đã lập / đang chờ), nút Đã gửi khách / Khách đồng ý / Từ chối / Huỷ / Sửa.
- Hợp đồng bán (sheet): ô vàng "Khách đã đồng ý … chưa lập phụ lục", mục **Phụ lục** (+/− sau thuế, từ CR nào, huỷ), dialog lập phụ lục (tăng / giảm, chọn CR, đợt thu mới), ô giá trị hiện "Gốc … · n phụ lục".

E2E: `scripts/dev/projects-cr-e2e.ts` ([e2e.md](../e2e.md)).
