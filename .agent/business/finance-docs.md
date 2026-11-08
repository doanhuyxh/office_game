# Tài chính: chứng từ + Excel sổ thu chi

> Nguồn sự thật là code: `backend/src/Modules/Finance/` (`Domain/AttachmentRules.cs`, `Features/AttachmentEndpoints.cs`, `Features/LedgerExport.cs`); FE `features/finance/components/{attachments-dialog,attachment-button}`. Sổ thu chi + quyền: [finance.md](finance.md). Về [README.md](README.md).

Công ty không dùng phần mềm kế toán → kế toán thuế / dịch vụ cần **chứng từ gốc** gắn với từng khoản và **Excel** để làm sổ sách theo luật (hệ thống vẫn chỉ là sổ quản trị).

## Chứng từ (bảng `finance.attachments`, migration `AddFinanceAttachments`)

Gắn **dòng sổ** (`OwnerType = Entry`) hoặc **đề nghị chi** (`Expense`). File ở S3 `finance/{yyyy}/{MM}/{id}/{tên an toàn}` — trình duyệt tải thẳng (cần CORS bucket, đã bật).

1. `POST /api/finance/attachments { ownerType, ownerId, fileName, contentType?, size }` → dòng chờ (`Ready = false`) + presigned PUT (15 phút). Dòng chờ > 1 ngày tự dọn (file mồ côi để lại).
2. Trình duyệt `PUT` đúng `Content-Type` trả về.
3. `POST /attachments/{id}/confirm` (chỉ người xin link; người khác 404) → HEAD S3: chưa có file → 409; > 20 MB → xoá file + 400; đúng → `Ready`.

Đọc: `GET /attachments?ownerType&ownerId` (đã xác nhận, chưa xoá), `GET /attachments/{id}/url[?download=true]` (presigned GET 10 phút; PDF / ảnh xem trong trình duyệt). Xoá: `DELETE /attachments/{id}` = **ẩn** (`DeletedAt`, `DeletedByName`), file giữ lại.

Quy tắc (`AttachmentRules`): PDF, ảnh (png / jpg / webp / heic), Excel, Word, csv, **XML (hoá đơn điện tử)**, zip, txt; ≤ 20 MB; ≤ 20 chứng từ / chủ.

| | Đọc | Thêm | Xoá |
|---|---|---|---|
| Dòng sổ | Xem tài chính | Ghi sổ, dòng còn hiệu lực | như thêm, **trừ kỳ đã khoá** (kỳ khoá vẫn thêm được) |
| Đề nghị chi | người gửi, **quản lý trực tiếp** của người gửi, Xem tài chính | người gửi khi Chờ duyệt / Đã duyệt; Ghi sổ luôn | như thêm |

Dòng sổ chi theo đề nghị (`SourceType = expense_request`): danh sách chứng từ của dòng **kèm chứng từ của đề nghị** (`ownerType = Expense`, `canDelete = false` ở đó). `attachmentCount` trên `EntryDto` (gồm của đề nghị) và `ExpenseDto`. Người không thấy chủ → 404. Token AI: `/api/finance/*` ngoài allowlist → 403.

## Excel (`GET /api/finance/entries/export.xlsx`, quyền Xem tài chính)

`?from&to&accountId&lineId&projectId` — mặc định từ đầu tháng tới hôm nay; `to < from` → 400; tối đa 5 năm. Dòng đã huỷ không xuất. Tên file `so-thu-chi-{from}-{to}.xlsx`.

- **Sổ thu chi** (theo bộ lọc): ngày, loại, thu / chi / chuyển quỹ, quỹ, quỹ nhận, danh mục, mảng, dự án, đối tác, diễn giải, số hoá đơn, số chứng từ, người ghi + dòng tổng.
- **Sổ quỹ** (mỗi quỹ, hoặc quỹ đang lọc; **bỏ qua** lọc mảng / dự án vì là số dư của cả quỹ): số dư đầu kỳ (= đầu kỳ của quỹ + phát sinh trước `from`, `LedgerRules.Balance`), từng dòng thu / chi / chuyển với tồn luỹ kế, cộng phát sinh + cuối kỳ.
- **Tổng hợp** (không tính chuyển quỹ): theo loại × danh mục; theo mảng (thu, chi, chênh lệch).

## UI

Sổ thu chi: cột 📎 (số chứng từ → dialog xem / tải / thêm / xoá), nút **Excel** (theo khoảng ngày + quỹ đang lọc). Đề nghị chi: cột 📎; gửi đề nghị xong mở ngay dialog để đính kèm hoá đơn.

E2E: `scripts/dev/finance-docs-e2e.ts` ([e2e.md](../e2e.md)).
