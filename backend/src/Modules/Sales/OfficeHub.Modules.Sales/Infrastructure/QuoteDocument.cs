using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using OfficeHub.BuildingBlocks.Documents;
using OfficeHub.Modules.Sales.Domain;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace OfficeHub.Modules.Sales.Infrastructure;

public sealed record QuoteFieldDto(string Name, string Description, string Example);

/// <summary>
/// File Word báo giá: mẫu của công ty (Cấu hình → tải lên, S3 <c>sales/templates/</c>) hoặc mẫu mặc định sinh bằng code.
/// Trường <c>{{Ten}}</c> như mẫu hợp đồng lao động; dòng bảng chứa <c>{{HM_…}}</c> lặp theo từng hạng mục (<see cref="DocxTemplate"/>).
/// </summary>
internal static class QuoteDocument
{
    public const string RowPrefix = "HM_";

    public static readonly IReadOnlyList<QuoteFieldDto> Fields =
    [
        new("SoBaoGia", "Số báo giá (kèm phiên bản)", "BG-00012-v2"), new("NgayBaoGia", "Ngày báo giá", "08/11/2026"),
        new("HieuLucDen", "Hiệu lực đến", "08/12/2026"), new("TieuDe", "Tên báo giá", "Thiết kế app đặt lịch"),
        new("KhachHang", "Tên khách hàng", "Công ty TNHH ABC"), new("MaSoThue", "Mã số thuế khách", "0312345678"),
        new("DiaChiKhach", "Địa chỉ khách", "12 Lê Lợi, Q.1, TP.HCM"), new("DienThoaiKhach", "Điện thoại khách", "028 3812 3456"),
        new("EmailKhach", "Email khách", "info@abc.vn"), new("NguoiLienHe", "Người liên hệ chính (chức danh)", "Nguyễn Văn A (Giám đốc)"),
        new("NguoiPhuTrach", "Nhân viên kinh doanh phụ trách", "Trần Thị B"),
        new("TongTien", "Cộng tiền hàng / dịch vụ", "100.000.000"), new("TyLeChietKhau", "Chiết khấu %", "10"),
        new("ChietKhau", "Tiền chiết khấu", "10.000.000"), new("TruocThue", "Thành tiền trước thuế", "90.000.000"),
        new("ThueSuat", "Thuế suất VAT %", "10"), new("TienThue", "Tiền VAT", "9.000.000"), new("TongCong", "Tổng cộng thanh toán", "99.000.000"),
        new("TongCongBangChu", "Tổng cộng bằng chữ", "Chín mươi chín triệu đồng"), new("DieuKhoan", "Điều khoản (thanh toán, bảo hành…)", "Thanh toán 2 đợt…"),
        new("GhiChu", "Ghi chú", ""),
        new("HM_STT", "(dòng bảng) Số thứ tự", "1"), new("HM_NoiDung", "(dòng bảng) Nội dung hạng mục", "Thiết kế giao diện"),
        new("HM_DonVi", "(dòng bảng) Đơn vị tính", "màn hình"), new("HM_SoLuong", "(dòng bảng) Số lượng", "12"),
        new("HM_DonGia", "(dòng bảng) Đơn giá", "2.500.000"), new("HM_ThanhTien", "(dòng bảng) Thành tiền", "30.000.000"),
    ];

    public static (Dictionary<string, string> Values, List<IReadOnlyDictionary<string, string>> Rows) Data(Quote q, Customer c, Contact? contact, string ownerName) => (
        new Dictionary<string, string>
        {
            ["SoBaoGia"] = QuoteRules.Code(q.Number, q.Version), ["NgayBaoGia"] = $"{q.IssuedOn:dd/MM/yyyy}", ["HieuLucDen"] = $"{q.ValidUntil:dd/MM/yyyy}",
            ["TieuDe"] = q.Title, ["KhachHang"] = c.Name, ["MaSoThue"] = c.TaxCode ?? "", ["DiaChiKhach"] = c.Address ?? "", ["DienThoaiKhach"] = c.Phone ?? "",
            ["EmailKhach"] = c.Email ?? "", ["NguoiLienHe"] = contact is null ? "" : contact.Title is { Length: > 0 } t ? $"{contact.Name} ({t})" : contact.Name,
            ["NguoiPhuTrach"] = ownerName, ["TongTien"] = QuoteRules.Money(q.Subtotal), ["TyLeChietKhau"] = QuoteRules.Qty(q.DiscountPercent),
            ["ChietKhau"] = QuoteRules.Money(q.Discount), ["TruocThue"] = QuoteRules.Money(q.BeforeTax), ["ThueSuat"] = q.VatRate.ToString(),
            ["TienThue"] = QuoteRules.Money(q.Vat), ["TongCong"] = QuoteRules.Money(q.Total), ["TongCongBangChu"] = VietnameseNumber.MoneyToWords(q.Total),
            ["DieuKhoan"] = q.Terms ?? "", ["GhiChu"] = q.Note ?? "",
        },
        q.Lines.OrderBy(l => l.Order).Select((l, i) => (IReadOnlyDictionary<string, string>)new Dictionary<string, string>
        {
            ["HM_STT"] = (i + 1).ToString(), ["HM_NoiDung"] = l.Description, ["HM_DonVi"] = l.Unit ?? "", ["HM_SoLuong"] = QuoteRules.Qty(l.Quantity),
            ["HM_DonGia"] = QuoteRules.Money(l.UnitPrice), ["HM_ThanhTien"] = QuoteRules.Money(l.Amount),
        }).ToList());

    public static byte[] Render(Stream template, Quote q, Customer c, Contact? contact, string ownerName)
    {
        var (values, rows) = Data(q, c, contact, ownerName);
        return DocxTemplate.Fill(template, values, rows, RowPrefix);
    }

    /// <summary>Mẫu mặc định (A4, Times New Roman) — cũng là file để công ty tải về sửa thành mẫu riêng.</summary>
    public static byte[] DefaultTemplate()
    {
        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            var body = new W.Body();
            body.Append(
                P("BÁO GIÁ", bold: true, size: 32, center: true),
                P("Số: {{SoBaoGia}} — Ngày {{NgayBaoGia}}", center: true),
                P(""),
                P("Kính gửi: {{KhachHang}}", bold: true),
                P("Mã số thuế: {{MaSoThue}} · Địa chỉ: {{DiaChiKhach}}"),
                P("Người liên hệ: {{NguoiLienHe}}"),
                P(""),
                P("V/v: {{TieuDe}}", bold: true),
                P("Chúng tôi trân trọng gửi Quý khách báo giá như sau (đơn vị: đồng):"),
                Table(),
                P(""),
                P("Cộng: {{TongTien}} · Chiết khấu {{TyLeChietKhau}}%: {{ChietKhau}}"),
                P("Thành tiền trước thuế: {{TruocThue}} · VAT {{ThueSuat}}%: {{TienThue}}"),
                P("TỔNG CỘNG: {{TongCong}} đồng", bold: true),
                P("Bằng chữ: {{TongCongBangChu}}", italic: true),
                P(""),
                P("Điều khoản: {{DieuKhoan}}"),
                P("Ghi chú: {{GhiChu}}"),
                P("Báo giá có hiệu lực đến hết ngày {{HieuLucDen}}."),
                P(""),
                P("Người phụ trách: {{NguoiPhuTrach}}", bold: true),
                new W.SectionProperties(new W.PageSize { Width = 11906, Height = 16838 },
                    new W.PageMargin { Top = 1134, Bottom = 1134, Left = 1418, Right = 1134, Header = 708, Footer = 708, Gutter = 0 }));
            main.Document = new W.Document(body);
            var styles = main.AddNewPart<StyleDefinitionsPart>();
            styles.Styles = new W.Styles(new W.DocDefaults(new W.RunPropertiesDefault(new W.RunPropertiesBaseStyle(
                new W.RunFonts { Ascii = "Times New Roman", HighAnsi = "Times New Roman", ComplexScript = "Times New Roman" }, new W.FontSize { Val = "24" }))));
            main.Document.Save();
        }
        return ms.ToArray();
    }

    private static W.Paragraph P(string text, bool bold = false, bool italic = false, int? size = null, bool center = false)
    {
        var rp = new W.RunProperties();
        if (bold) rp.Append(new W.Bold());
        if (italic) rp.Append(new W.Italic());
        if (size is { } s) rp.Append(new W.FontSize { Val = s.ToString() });
        var p = new W.Paragraph(new W.Run(rp, new W.Text(text) { Space = SpaceProcessingModeValues.Preserve }));
        if (center) p.PrependChild(new W.ParagraphProperties(new W.Justification { Val = W.JustificationValues.Center }));
        return p;
    }

    private static W.Table Table()
    {
        var border = new W.TableBorders(
            new W.TopBorder { Val = W.BorderValues.Single, Size = 4 }, new W.BottomBorder { Val = W.BorderValues.Single, Size = 4 },
            new W.LeftBorder { Val = W.BorderValues.Single, Size = 4 }, new W.RightBorder { Val = W.BorderValues.Single, Size = 4 },
            new W.InsideHorizontalBorder { Val = W.BorderValues.Single, Size = 4 }, new W.InsideVerticalBorder { Val = W.BorderValues.Single, Size = 4 });
        var t = new W.Table(new W.TableProperties(border, new W.TableWidth { Width = "5000", Type = W.TableWidthUnitValues.Pct }));
        W.TableRow Row(bool bold, params string[] cells) => new(cells.Select(x => new W.TableCell(P(x, bold: bold))));
        t.Append(Row(true, "STT", "Nội dung", "ĐVT", "SL", "Đơn giá", "Thành tiền"));
        t.Append(Row(false, "{{HM_STT}}", "{{HM_NoiDung}}", "{{HM_DonVi}}", "{{HM_SoLuong}}", "{{HM_DonGia}}", "{{HM_ThanhTien}}"));
        return t;
    }
}
