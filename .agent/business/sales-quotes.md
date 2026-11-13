# Báo giá (module Sales)

> Nguồn sự thật là code: `backend/src/Modules/Sales/` (`Domain/Quotes.cs` — `QuoteRules`, `Features/QuoteEndpoints.cs`, `Infrastructure/QuoteDocument.cs`, `QuoteApprovalHandler.cs`); FE `features/sales/components/{quotes-tab,quote-sheet,quote-form-dialog,quote-settings-dialog}`. Khách / hợp đồng: [sales.md](sales.md). Về [README.md](README.md).

Kế hoạch [docs/BUSINESS_PLAN.md](../../docs/BUSINESS_PLAN.md) §3b: hạng mục (SL × đơn giá), chiết khấu, VAT, hiệu lực, phiên bản; xuất Word theo mẫu; chiết khấu vượt ngưỡng → duyệt. **Không xuất PDF** (cần LibreOffice trên server — để sau).

## Quy tắc (`QuoteRules`, test `tests/OfficeHub.Modules.Sales.Tests/QuoteRulesTests.cs`)

- Thành tiền dòng = làm tròn(SL × đơn giá); SL > 0, ≤ 2 chữ số thập phân; 1–200 dòng. Cộng → chiết khấu % (0–100, 2 số lẻ) trên tổng → trước thuế → VAT (0 / 5 / 8 / 10 %) → tổng. Tổng > 0.
- Mã `BG-00012`, phiên bản 2 trở đi `BG-00012-v2` (cùng `Number`, unique `Number + Version`; tạo đồng thời → thử số kế).
- **Chiết khấu VƯỢT** ngưỡng (bằng ngưỡng thì không) → cần duyệt. Ngưỡng ở `sales.settings` (một dòng), mặc định 15 %, **chỉ Quản trị tài chính** đổi.

## Trạng thái

Nháp → **Chốt**: trong ngưỡng → *Sẵn sàng*; vượt ngưỡng → *Chờ duyệt* + đơn Approval `quote_discount` bước `[Finance]` (người gửi phải có hồ sơ). Duyệt → *Sẵn sàng*; từ chối → về *Nháp* + `approvalComment`; người gửi huỷ đơn → *Nháp*.
**Mỗi lần gửi duyệt dùng `ApprovalSubjectId` mới** (Approval unique `Type + SubjectId` → gửi lại sau khi bị từ chối phải là đơn mới); handler tìm báo giá theo mã này.
*Sẵn sàng* → *Đã gửi khách* → *Khách đồng ý* / *Khách từ chối* (`decidedOn` ≤ hôm nay, ghi chú). Chỉ sửa khi *Nháp*. **Phiên bản mới** (từ Nháp / Sẵn sàng / Đã gửi / Từ chối, phải là bản mới nhất; không khi Chờ duyệt) → chép thành Nháp v+1, bản cũ *Đã thay*. Huỷ: Nháp / Sẵn sàng / Đã gửi. Hết hiệu lực (`validUntil` < hôm nay) chỉ là cờ `expired`; chốt khi đã hết hiệu lực → 409.

**Lập hợp đồng**: `POST /api/sales/contracts { …, quoteId }` — báo giá cùng khách, đang Sẵn sàng / Đã gửi / Khách đồng ý, chưa có hợp đồng → báo giá *Khách đồng ý* + `ContractId`. FE điền sẵn giá trị trước thuế, VAT (khoá, không sửa), tên, cơ hội, điều khoản (ghi chú), một đợt thu trọn giá trị. BE bắt `valueBeforeTax` + `vatRate` **đúng như báo giá** (khác → 400 `errors.valueBeforeTax`) — không lách duyệt chiết khấu `quote_discount` bằng hợp đồng giá thấp hơn; đổi giá sau ký → phụ lục.

## Quyền

Như khách hàng ([sales.md](sales.md)): thấy = người phụ trách khách + quản lý của họ + Xem tài chính; tạo / sửa / đổi trạng thái = `SalesViewer.CanEdit`. Người không thấy → 404. Token AI (TEST-77): chỉ `GET /quotes`, `/quotes/{id}` (`list_quotes`, `get_quote`); ghi, `export.docx`, `/settings*` → 403.

## API (`/api/sales`)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/quotes?search&status&customerId&includeOld&page` | Mặc định bỏ *Đã thay* / *Đã huỷ* |
| GET | `/quotes/{id}` | + dòng, `versions[]`, `needsApproval`, `discountLimitPercent`, `canEdit` |
| POST / PUT | `/quotes`, `/quotes/{id}` | `{ customerId, title, validUntil, vatRate, lines[{description, unit?, quantity, unitPrice}], discountPercent, issuedOn?, opportunityId? (của khách), businessLineId?, terms?, note? }`; PUT chỉ Nháp, không đổi khách |
| POST | `/quotes/{id}/submit` · `/sent` · `/result {accepted, decidedOn?, note?}` · `/revise` · `/cancel` | |
| GET | `/quotes/{id}/export.docx` | Mẫu công ty nếu có, không thì mẫu mặc định; người liên hệ = liên hệ chính |
| GET / PUT | `/settings` | `{ quoteDiscountLimitPercent, quoteTemplateName, canEditLimit, canEditTemplate }`; PUT = Quản trị tài chính |
| GET | `/settings/quote-template/fields` · `/settings/quote-template/default` | Danh sách trường · tải mẫu mặc định (.docx) để sửa |
| POST / DELETE | `/settings/quote-template` | Multipart `file` .docx ≤ 10 MB, phải có ≥ 1 trường (S3 `sales/templates/`) — **HR hoặc Quản trị tài chính**; DELETE = về mẫu mặc định (file cũ giữ) |

## Mẫu Word

Engine dùng chung `BuildingBlocks/Documents/DocxTemplate` (chuyển từ LaborContracts 2026-11-08, cùng `VietnameseNumber`): `{{Truong}}` + **bảng lặp** — mọi dòng bảng chứa trường tiền tố `HM_` được nhân theo hạng mục. Trường: `SoBaoGia, NgayBaoGia, HieuLucDen, TieuDe, KhachHang, MaSoThue, DiaChiKhach, DienThoaiKhach, EmailKhach, NguoiLienHe, NguoiPhuTrach, TongTien, TyLeChietKhau, ChietKhau, TruocThue, ThueSuat, TienThue, TongCong, TongCongBangChu, DieuKhoan, GhiChu` + dòng `HM_STT, HM_NoiDung, HM_DonVi, HM_SoLuong, HM_DonGia, HM_ThanhTien`. Mẫu mặc định (A4, Times New Roman) sinh bằng code (`QuoteDocument.DefaultTemplate`).

## Schema (`SalesDbContext`, migration `AddQuotes`)

`quotes` (unique `Number + Version`; index khách, người phụ trách, `ApprovalSubjectId`; FK khách / cơ hội / hợp đồng Restrict), `quote_lines` (cascade), `settings` (Id = 1, `[Audited]`).

## UI

`/sales` → tab **Báo giá**: danh sách (lọc trạng thái, tìm), "Báo giá mới", **Cấu hình** (ngưỡng, mẫu Word, danh sách trường). Sheet báo giá: Tải Word, Sửa / Chốt (hoặc "Gửi duyệt chiết khấu"), Đã gửi khách, Khách đồng ý / từ chối, Lập hợp đồng, Phiên bản mới, Huỷ, danh sách phiên bản.

E2E: `scripts/dev/sales-quotes-e2e.ts` ([e2e.md](../e2e.md)).
