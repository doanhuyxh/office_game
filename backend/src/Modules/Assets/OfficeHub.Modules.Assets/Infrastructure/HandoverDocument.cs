using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using OfficeHub.BuildingBlocks.Documents;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Features;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace OfficeHub.Modules.Assets.Infrastructure;

/// <summary>
/// File Word biên bản giao nhận thiết bị: mẫu riêng của công ty (Danh mục → Mẫu biên bản, S3 <c>assets/templates/</c>) hoặc mẫu mặc định sinh bằng code.
/// Trường <c>{{Ten}}</c> như mẫu hợp đồng lao động / báo giá (<see cref="DocxTemplate"/>). Thời gian in theo múi giờ văn phòng.
/// </summary>
internal static class HandoverDocument
{
    public const string DocxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    public static readonly IReadOnlyList<TemplateFieldDto> Fields =
    [
        new("SoBienBan", "Số biên bản", "BB-2026-00012"), new("LoaiBienBan", "BÀN GIAO hoặc THU HỒI", "BÀN GIAO"),
        new("NgayLap", "Ngày lập", "09/11/2026"), new("GioLap", "Giờ lập", "14:30"),
        new("NguoiLap", "Người lập (HR)", "Nguyễn Thị HR"),
        new("MaNhanVien", "Mã nhân viên", "NV012"), new("NhanVien", "Họ tên nhân viên", "Trần Văn A"), new("PhongBan", "Phòng ban", "Công nghệ"),
        new("MaThietBi", "Mã thiết bị", "TB-MT-00003"), new("TenThietBi", "Tên thiết bị", "MacBook Pro 14"), new("LoaiThietBi", "Loại", "Máy tính"),
        new("Hang", "Hãng", "Apple"), new("Model", "Model", "M3 Pro 18GB"), new("SoSerial", "Số serial", "C02XK0ABCD"),
        new("GhiChu", "Ghi chú khi giao / thu hồi (tình trạng, phụ kiện kèm theo…)", "Kèm sạc, túi chống sốc"),
        new("XacNhan", "Trạng thái xác nhận của nhân viên", "Đã xác nhận lúc 14:35 09/11/2026 (IP 203.0.113.5)"),
    ];

    public static Dictionary<string, string> Data(HandoverRecord h, TimeZoneInfo tz)
    {
        var at = TimeZoneInfo.ConvertTime(h.CreatedAt, tz);
        string confirm;
        if (h.ConfirmedAt is { } c)
        {
            var lc = TimeZoneInfo.ConvertTime(c, tz);
            confirm = $"Đã xác nhận trên OfficeHub lúc {lc:HH:mm dd/MM/yyyy}{(h.ConfirmedIp is { } ip ? $" (IP {ip})" : "")}";
        }
        else confirm = h.RequiresConfirmation ? "Chưa xác nhận" : "Không yêu cầu xác nhận trên hệ thống";
        return new()
        {
            ["SoBienBan"] = h.Number, ["LoaiBienBan"] = h.Kind == HandoverKind.Assign ? "BÀN GIAO" : "THU HỒI",
            ["NgayLap"] = $"{at:dd/MM/yyyy}", ["GioLap"] = $"{at:HH:mm}", ["NguoiLap"] = h.CreatedByName,
            ["MaNhanVien"] = h.EmployeeCode, ["NhanVien"] = h.EmployeeName, ["PhongBan"] = h.DepartmentName ?? "",
            ["MaThietBi"] = h.DeviceCode, ["TenThietBi"] = h.DeviceName, ["LoaiThietBi"] = h.CategoryName ?? "",
            ["Hang"] = h.Brand ?? "", ["Model"] = h.Model ?? "", ["SoSerial"] = h.SerialNumber ?? "", ["GhiChu"] = h.Note ?? "",
            ["XacNhan"] = confirm,
        };
    }

    public static byte[] Render(Stream template, HandoverRecord h, TimeZoneInfo tz) => DocxTemplate.Fill(template, Data(h, tz));

    public static string FileName(HandoverRecord h) => $"bien-ban-{h.Number}.docx";

    /// <summary>Mẫu mặc định (A4, Times New Roman) — cũng là file để công ty tải về sửa thành mẫu riêng.</summary>
    public static byte[] DefaultTemplate()
    {
        using var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            var body = new W.Body();
            body.Append(
                P("CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM", bold: true, center: true),
                P("Độc lập - Tự do - Hạnh phúc", bold: true, center: true),
                P(""),
                P("BIÊN BẢN {{LoaiBienBan}} THIẾT BỊ", bold: true, size: 30, center: true),
                P("Số: {{SoBienBan}}", center: true),
                P(""),
                P("Hôm nay, lúc {{GioLap}} ngày {{NgayLap}}, chúng tôi gồm:"),
                P("Bên công ty: {{NguoiLap}} — đại diện bộ phận quản lý tài sản", bold: true),
                P("Nhân viên: {{NhanVien}} — Mã NV: {{MaNhanVien}} — Phòng ban: {{PhongBan}}", bold: true),
                P(""),
                P("Cùng thống nhất {{LoaiBienBan}} thiết bị dưới đây:"),
                Table(),
                P(""),
                P("Ghi chú (tình trạng, phụ kiện kèm theo): {{GhiChu}}"),
                P(""),
                P("Nhân viên có trách nhiệm bảo quản, sử dụng thiết bị đúng mục đích công việc và hoàn trả khi công ty yêu cầu hoặc khi nghỉ việc."),
                P(""),
                P("Xác nhận của nhân viên: {{XacNhan}}", italic: true),
                P(""),
                SignTable(),
                new W.SectionProperties(new W.PageSize { Width = 11906, Height = 16838 },
                    new W.PageMargin { Top = 1134, Bottom = 1134, Left = 1418, Right = 1134, Header = 708, Footer = 708, Gutter = 0 }));
            main.Document = new W.Document(body);
            var styles = main.AddNewPart<StyleDefinitionsPart>();
            styles.Styles = new W.Styles(new W.DocDefaults(new W.RunPropertiesDefault(new W.RunPropertiesBaseStyle(
                new W.RunFonts { Ascii = "Times New Roman", HighAnsi = "Times New Roman", ComplexScript = "Times New Roman" }, new W.FontSize { Val = "26" }))));
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
        t.Append(Row(true, "Mã thiết bị", "Tên thiết bị", "Loại", "Hãng / Model", "Số serial"));
        t.Append(Row(false, "{{MaThietBi}}", "{{TenThietBi}}", "{{LoaiThietBi}}", "{{Hang}} {{Model}}", "{{SoSerial}}"));
        return t;
    }

    private static W.Table SignTable()
    {
        var t = new W.Table(new W.TableProperties(new W.TableWidth { Width = "5000", Type = W.TableWidthUnitValues.Pct }));
        t.Append(new W.TableRow(new W.TableCell(P("ĐẠI DIỆN CÔNG TY", bold: true, center: true)), new W.TableCell(P("NHÂN VIÊN", bold: true, center: true))));
        t.Append(new W.TableRow(new W.TableCell(P("(Ký, ghi rõ họ tên)", italic: true, center: true)), new W.TableCell(P("(Ký, ghi rõ họ tên)", italic: true, center: true))));
        t.Append(new W.TableRow(new W.TableCell(P("")), new W.TableCell(P(""))));
        t.Append(new W.TableRow(new W.TableCell(P("")), new W.TableCell(P(""))));
        t.Append(new W.TableRow(new W.TableCell(P("{{NguoiLap}}", center: true)), new W.TableCell(P("{{NhanVien}}", center: true))));
        return t;
    }
}
