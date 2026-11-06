using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Tests;

public class VietnameseNumberTests
{
    [Theory]
    [InlineData(0, "Không đồng")]
    [InlineData(15_000_000, "Mười lăm triệu đồng")]
    [InlineData(15_500_000, "Mười lăm triệu năm trăm nghìn đồng")]
    [InlineData(1_050_000, "Một triệu không trăm năm mươi nghìn đồng")]
    [InlineData(8_005_000, "Tám triệu không trăm lẻ năm nghìn đồng")]
    [InlineData(21_000_000, "Hai mươi mốt triệu đồng")]
    [InlineData(24_100_000, "Hai mươi tư triệu một trăm nghìn đồng")]
    [InlineData(14_000_000, "Mười bốn triệu đồng")]
    [InlineData(105, "Một trăm lẻ năm đồng")]
    [InlineData(1_000_000_000, "Một tỷ đồng")]
    [InlineData(2_300_015, "Hai triệu ba trăm nghìn không trăm mười lăm đồng")]
    public void Reads_money_in_vietnamese(long amount, string expected) => Assert.Equal(expected, VietnameseNumber.MoneyToWords(amount));
}

public class ContractFieldsTests
{
    [Theory]
    [InlineData(ContractType.Fixed, "2026-11-01", "2027-10-31", "12 tháng")]
    [InlineData(ContractType.Fixed, "2026-01-15", "2029-01-14", "36 tháng")]
    [InlineData(ContractType.Fixed, "2026-11-01", "2027-01-10", "71 ngày")]
    [InlineData(ContractType.Probation, "2026-11-01", "2026-12-30", "60 ngày")]
    [InlineData(ContractType.Indefinite, "2026-11-01", null, "Không xác định thời hạn")]
    public void Duration_text(ContractType type, string start, string? end, string expected) =>
        Assert.Equal(expected, ContractFields.Duration(type, DateOnly.Parse(start), end is null ? null : DateOnly.Parse(end)));

    [Fact]
    public void Values_format_money_dates_and_words()
    {
        var v = ContractFields.Values(new ContractFields.Source("Nguyễn Văn An", "NV012", new DateOnly(1995, 8, 15), null, null, "Kỹ thuật", "Chuyên viên",
            "HĐ-01", ContractType.Indefinite, null, new DateOnly(2026, 11, 1), null, null, 15_000_000m, null, new DateOnly(2026, 11, 6)));
        Assert.Equal("15.000.000", v["Luong"]);
        Assert.Equal("Mười lăm triệu đồng", v["luongbangchu"]); // không phân biệt hoa thường
        Assert.Equal("15/08/1995", v["NgaySinh"]);
        Assert.Equal("Không xác định", v["NgayKetThuc"]);
        Assert.Equal("Chuyên viên", v["ChucDanh"]);              // không có chức danh HĐ → chức vụ
        Assert.Equal("ngày 06 tháng 11 năm 2026", v["NgayHienTai"]);
        Assert.Equal("", v["PhuCap"]);
    }
}

public class DocxTemplateTests
{
    /// <summary>Đoạn văn mà Word đã tách trường thành nhiều run có định dạng khác nhau.</summary>
    private static MemoryStream BuildDocx(params Run[][] paragraphs)
    {
        var ms = new MemoryStream();
        using (var doc = WordprocessingDocument.Create(ms, WordprocessingDocumentType.Document))
        {
            var main = doc.AddMainDocumentPart();
            main.Document = new Document(new Body(paragraphs.Select(runs => new Paragraph(runs.Cast<OpenXmlElement>()))));
            var header = main.AddNewPart<HeaderPart>();
            header.Header = new Header(new Paragraph(R("Số: {{SoHopDong}}")));
            main.Document.Save();
        }
        ms.Position = 0;
        return ms;
    }

    private static Run R(string text, bool bold = false) =>
        new(bold ? new RunProperties(new Bold()) : new RunProperties(), new Text(text) { Space = SpaceProcessingModeValues.Preserve });

    private static List<string> ReadParagraphs(byte[] docx, out string header)
    {
        using var doc = WordprocessingDocument.Open(new MemoryStream(docx), false);
        header = doc.MainDocumentPart!.HeaderParts.First().Header!.InnerText;
        return doc.MainDocumentPart.Document!.Body!.Elements<Paragraph>().Select(p => p.InnerText).ToList();
    }

    [Fact]
    public void Scans_fields_even_when_split_across_runs()
    {
        using var ms = BuildDocx([R("Ông/bà: {{Ho"), R("Ten", true), R("}} sinh ngày {{ NgaySinh }}")], [R("{{TruongLa}}")]);
        Assert.Equal(["HoTen", "NgaySinh", "TruongLa", "SoHopDong"], DocxTemplate.ScanFields(ms));
    }

    [Fact]
    public void Fills_split_fields_keeps_surrounding_runs_and_unknown_fields()
    {
        using var ms = BuildDocx(
            [R("Ông/bà: "), R("{{Ho", true), R("Ten}}"), R(" — lương "), R("{{Luong}}", true), R(" đồng ({{LuongBangChu}}).")],
            [R("Giữ nguyên: {{TruongLa}}")]);
        var bytes = DocxTemplate.Fill(ms, new Dictionary<string, string>
        {
            ["hoten"] = "Nguyễn Văn An", ["Luong"] = "15.000.000", ["LuongBangChu"] = "Mười lăm triệu đồng", ["SoHopDong"] = "HĐ-01",
        });
        var paras = ReadParagraphs(bytes, out var header);
        Assert.Equal("Ông/bà: Nguyễn Văn An — lương 15.000.000 đồng (Mười lăm triệu đồng).", paras[0]);
        Assert.Equal("Giữ nguyên: {{TruongLa}}", paras[1]);
        Assert.Equal("Số: HĐ-01", header);

        // Run đậm chứa đầu trường giữ định dạng đậm cho giá trị; run " — lương " vẫn thường.
        using var doc = WordprocessingDocument.Open(new MemoryStream(bytes), false);
        var runs = doc.MainDocumentPart!.Document!.Body!.Elements<Paragraph>().First().Elements<Run>().ToList();
        Assert.Equal("Nguyễn Văn An", runs[1].InnerText);
        Assert.NotNull(runs[1].RunProperties?.Bold);
        Assert.Null(runs[3].RunProperties?.Bold);
    }
}
