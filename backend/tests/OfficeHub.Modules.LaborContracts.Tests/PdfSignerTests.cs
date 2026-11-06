using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Tests;

public class PdfSignerTests
{
    // PNG 1×1 trong suốt (ảnh chữ ký tối giản)
    private static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");

    private static byte[] OnePagePdf()
    {
        PdfSigner.EnsureFonts();
        var doc = new PdfDocument();
        var p = doc.AddPage();
        using (var g = XGraphics.FromPdfPage(p)) g.DrawString("HỢP ĐỒNG LAO ĐỘNG — nội dung thử", new XFont("Noto Sans", 14), XBrushes.Black, 60, 80);
        using var ms = new MemoryStream();
        doc.Save(ms);
        return ms.ToArray();
    }

    [Fact]
    public void Stamp_adds_certificate_page_and_keeps_original_pages()
    {
        var stamp = new SignStamp("HĐ-01", "Nguyễn Văn An", "NV012", "an.nguyen@congty.vn", new DateTimeOffset(2026, 11, 6, 3, 15, 0, TimeSpan.Zero),
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"), "203.0.113.5", "Mozilla/5.0 (iPhone)", new string('a', 64), Guid.NewGuid(), "email");
        var signed = PdfSigner.Stamp(OnePagePdf(), Png, stamp);
        using var doc = PdfReader.Open(new MemoryStream(signed), PdfDocumentOpenMode.Import);
        Assert.Equal(2, doc.PageCount);
        if (Environment.GetEnvironmentVariable("DUMP_SIGNED_PDF") is { Length: > 0 } path) File.WriteAllBytes(path, signed);
    }

    [Fact]
    public void Broken_pdf_is_rejected_cleanly() =>
        Assert.Throws<InvalidDataException>(() => PdfSigner.Stamp("not a pdf"u8.ToArray(), Png,
            new SignStamp("x", "x", "x", null, DateTimeOffset.UtcNow, TimeZoneInfo.Utc, null, null, "", Guid.NewGuid(), "email")));

    [Theory]
    [InlineData("an.nguyen@congty.vn", "a••••••@congty.vn")]
    [InlineData("ab@x.vn", "a•@x.vn")]
    public void Masks_email(string email, string expected) => Assert.Equal(expected, PdfSigner.Mask(email));
}
