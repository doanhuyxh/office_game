using OfficeHub.BuildingBlocks.Pdf;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace OfficeHub.Modules.Documents.Domain;

/// <summary>
/// Đóng dấu PDF tài liệu Hạn chế / Mật (TEST-54): mỗi trang một dòng chéo mờ giữa trang + một dòng nhỏ ở chân trang, nội dung
/// <see cref="DocumentRules.WatermarkText"/> (mã nhân viên + giờ VN). Không che nội dung; bản gốc trên S3 giữ nguyên.
/// </summary>
public static class PdfWatermark
{
    /// <exception cref="InvalidDataException">PDF hỏng / có mật khẩu.</exception>
    public static byte[] Stamp(byte[] pdf, string text)
    {
        PdfFonts.Ensure();
        PdfDocument doc;
        try { doc = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Modify); }
        catch (Exception e) when (e is PdfReaderException or InvalidOperationException or NotSupportedException or IOException)
        {
            throw new InvalidDataException("Không mở được PDF để đóng dấu (file hỏng hoặc có mật khẩu)", e);
        }
        using (doc)
        {
            var big = new XFont(PdfFonts.Family, 36, XFontStyleEx.Bold);
            var small = new XFont(PdfFonts.Family, 8);
            var diagonalBrush = new XSolidBrush(XColor.FromArgb(55, 200, 30, 30));
            var footerBrush = new XSolidBrush(XColor.FromArgb(170, 150, 20, 20));
            foreach (var page in doc.Pages)
            {
                using var g = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
                double w = page.Width.Point, h = page.Height.Point;
                var state = g.Save();
                g.TranslateTransform(w / 2, h / 2);
                g.RotateTransform(-Math.Atan2(h, w) * 180 / Math.PI);
                var size = g.MeasureString(text, big);
                var font = size.Width > Math.Sqrt(w * w + h * h) * 0.8 ? new XFont(PdfFonts.Family, 22, XFontStyleEx.Bold) : big;
                g.DrawString(text, font, diagonalBrush, new XRect(-w, -30, 2 * w, 60), XStringFormats.Center);
                g.Restore(state);
                g.DrawString($"Tài liệu bảo mật — {text}", small, footerBrush, new XRect(0, h - 16, w - 12, 12), XStringFormats.CenterRight);
            }
            using var output = new MemoryStream();
            doc.Save(output, closeStream: false);
            return output.ToArray();
        }
    }
}
