using OfficeHub.BuildingBlocks.Pdf;
using OfficeHub.Modules.Documents.Domain;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace OfficeHub.Modules.Documents.Tests;

/// <summary>TEST-54: mức Hạn chế / Mật + watermark PDF.</summary>
public class DocumentProtectionTests
{
    private static readonly TimeZoneInfo Vn = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");

    [Fact]
    public void Watermark_text_is_code_and_vietnam_time()
    {
        var utc = new DateTimeOffset(2026, 11, 12, 16, 5, 0, TimeSpan.Zero); // 23:05 giờ VN
        Assert.Equal("NV018 2026/11/12-23:05", DocumentRules.WatermarkText("NV018", utc, Vn));
        Assert.Equal("NV001 2026/01/02-07:09", DocumentRules.WatermarkText("NV001", new DateTimeOffset(2026, 1, 2, 0, 9, 0, TimeSpan.Zero), Vn));
    }

    [Fact]
    public void Only_restricted_and_confidential_are_protected()
    {
        Assert.False(DocumentRules.IsProtected(Classification.Internal));
        Assert.True(DocumentRules.IsProtected(Classification.Restricted));
        Assert.True(DocumentRules.IsProtected(Classification.Confidential));
        Assert.True(DocumentRules.CanWatermark("Báo cáo.PDF"));
        Assert.False(DocumentRules.CanWatermark("anh.png"));
    }

    [Fact]
    public void Stamp_keeps_pages_and_produces_valid_pdf()
    {
        PdfFonts.Ensure();
        byte[] original;
        using (var doc = new PdfDocument())
        {
            for (var i = 0; i < 3; i++)
            {
                var page = doc.AddPage();
                using var g = XGraphics.FromPdfPage(page);
                g.DrawString($"Trang {i + 1}", new XFont(PdfFonts.Family, 12), XBrushes.Black, 40, 40);
            }
            using var ms = new MemoryStream();
            doc.Save(ms, closeStream: false);
            original = ms.ToArray();
        }
        var stamped = PdfWatermark.Stamp(original, "NV018 2026/11/12-23:05");
        Assert.True(stamped.Length > original.Length);
        using var reopened = PdfReader.Open(new MemoryStream(stamped), PdfDocumentOpenMode.Import);
        Assert.Equal(3, reopened.PageCount);
    }

    [Fact]
    public void Stamp_rejects_broken_pdf() =>
        Assert.Throws<InvalidDataException>(() => PdfWatermark.Stamp("không phải pdf"u8.ToArray(), "x"));
}
