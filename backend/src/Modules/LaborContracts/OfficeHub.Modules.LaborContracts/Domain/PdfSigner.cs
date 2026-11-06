using System.Globalization;
using System.Reflection;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace OfficeHub.Modules.LaborContracts.Domain;

/// <summary>Thông tin in lên PDF đã ký (trang xác thực + chân trang).</summary>
public sealed record SignStamp(string ContractNumber, string SignerName, string EmployeeCode, string? SignerEmail, DateTimeOffset SignedAtUtc,
    TimeZoneInfo Tz, string? Ip, string? UserAgent, string OriginalSha256, Guid RequestId, string OtpChannel);

/// <summary>
/// Đóng dấu chữ ký điện tử nội bộ lên PDF (PDFsharp): chân trang mỗi trang + một trang xác thực cuối (ảnh chữ ký, người ký,
/// thời điểm, IP, trình duyệt, SHA-256 bản gốc, mã yêu cầu). KHÔNG che nội dung hợp đồng. Đây là chữ ký điện tử theo Luật GDĐT 2023,
/// không phải chữ ký số CA.
/// </summary>
public static class PdfSigner
{
    private const string Font = "Noto Sans";
    private static int _init;

    /// <summary>Font nhúng (Noto Sans, OFL) — container Alpine không có font hệ thống, cần đủ dấu tiếng Việt.</summary>
    public static void EnsureFonts()
    {
        if (Interlocked.Exchange(ref _init, 1) == 1) return;
        GlobalFontSettings.FontResolver ??= new EmbeddedFontResolver();
    }

    /// <exception cref="InvalidDataException">PDF hỏng / có mật khẩu.</exception>
    public static byte[] Stamp(byte[] originalPdf, byte[] signaturePng, SignStamp s)
    {
        EnsureFonts();
        PdfDocument doc;
        try { doc = PdfReader.Open(new MemoryStream(originalPdf), PdfDocumentOpenMode.Modify); }
        catch (Exception e) when (e is PdfReaderException or InvalidOperationException or NotSupportedException or IOException)
        {
            throw new InvalidDataException("Không mở được PDF (file hỏng hoặc có mật khẩu)", e);
        }

        var local = TimeZoneInfo.ConvertTime(s.SignedAtUtc, s.Tz);
        var when = local.ToString("dd/MM/yyyy HH:mm:ss", CultureInfo.InvariantCulture);
        var small = new XFont(Font, 7);
        var footer = $"Đã ký điện tử bởi {s.SignerName} ({s.EmployeeCode}) lúc {when} — mã xác thực {s.RequestId.ToString()[..8].ToUpperInvariant()}";
        var total = doc.PageCount;
        for (var i = 0; i < total; i++)
        {
            var page = doc.Pages[i];
            using var g = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            g.DrawString($"{footer} · trang {i + 1}/{total + 1}", small, XBrushes.DimGray,
                new XRect(24, page.Height.Point - 18, page.Width.Point - 48, 12), XStringFormats.Center);
        }

        // Trang xác thực
        var cert = doc.AddPage();
        cert.Size = PdfSharp.PageSize.A4;
        using (var g = XGraphics.FromPdfPage(cert))
        {
            double x = 56, y = 64, w = cert.Width.Point - 112;
            g.DrawString("TRANG XÁC THỰC CHỮ KÝ ĐIỆN TỬ", new XFont(Font, 16, XFontStyleEx.Bold), XBrushes.Black, new XRect(x, y, w, 24), XStringFormats.TopLeft);
            y += 30;
            g.DrawString($"Hợp đồng số {s.ContractNumber}", new XFont(Font, 11), XBrushes.DimGray, new XRect(x, y, w, 16), XStringFormats.TopLeft);
            y += 36;
            var label = new XFont(Font, 9.5);
            var value = new XFont(Font, 10.5, XFontStyleEx.Bold);
            void Row(string k, string v, int width = 70)
            {
                g.DrawString(k, label, XBrushes.DimGray, new XRect(x, y, 170, 14), XStringFormats.TopLeft);
                foreach (var line in Wrap(v, width))
                {
                    g.DrawString(line, value, XBrushes.Black, new XRect(x + 175, y, w - 175, 14), XStringFormats.TopLeft);
                    y += 16;
                }
                y += 4;
            }
            Row("Người ký", $"{s.SignerName} — mã nhân viên {s.EmployeeCode}");
            if (s.SignerEmail is { Length: > 0 }) Row("Email nhận mã xác nhận", Mask(s.SignerEmail));
            Row("Thời điểm ký", $"{when} (giờ Việt Nam) · {s.SignedAtUtc.UtcDateTime:yyyy-MM-dd'T'HH:mm:ss'Z'} (UTC)");
            Row("Xác thực", $"Đăng nhập OfficeHub + mã OTP một lần gửi qua {s.OtpChannel}");
            Row("Địa chỉ IP", s.Ip ?? "—");
            Row("Trình duyệt", Truncate(s.UserAgent ?? "—", 180));
            Row("SHA-256 bản gốc", s.OriginalSha256, 32); // 64 ký tự hex → 2 dòng
            Row("Mã yêu cầu ký", s.RequestId.ToString());
            y += 10;
            g.DrawString("Chữ ký", label, XBrushes.DimGray, new XRect(x, y, 170, 14), XStringFormats.TopLeft);
            using (var img = XImage.FromStream(new MemoryStream(signaturePng)))
            {
                var maxW = 260.0; var maxH = 110.0;
                var scale = Math.Min(maxW / img.PointWidth, maxH / img.PointHeight);
                g.DrawRectangle(new XPen(XColors.LightGray, 0.5), x + 175, y, maxW, maxH);
                g.DrawImage(img, x + 175, y, img.PointWidth * scale, img.PointHeight * scale);
            }
            y += 130;
            foreach (var line in Wrap("Chữ ký điện tử theo Luật Giao dịch điện tử 2023: người ký đã đăng nhập tài khoản OfficeHub của mình và nhập mã " +
                                      "xác nhận một lần (OTP). Mã SHA-256 xác định chính xác nội dung bản gốc được ký; mọi thay đổi nội dung sẽ làm mã này khác đi.", 105))
            {
                g.DrawString(line, new XFont(Font, 8.5), XBrushes.DimGray, new XRect(x, y, w, 12), XStringFormats.TopLeft);
                y += 12;
            }
        }
        using var ms = new MemoryStream();
        doc.Save(ms);
        return ms.ToArray();
    }

    internal static string Mask(string email)
    {
        var at = email.IndexOf('@');
        return at <= 1 ? email : email[0] + new string('•', Math.Min(6, at - 1)) + email[at..];
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    private static IEnumerable<string> Wrap(string text, int width)
    {
        var line = "";
        foreach (var word in text.Split(' '))
        {
            if (line.Length + word.Length + 1 > width && line.Length > 0) { yield return line; line = ""; }
            line = line.Length == 0 ? word : line + " " + word;
            while (line.Length > width) { yield return line[..width]; line = line[width..]; }
        }
        if (line.Length > 0) yield return line;
    }

    private sealed class EmbeddedFontResolver : IFontResolver
    {
        public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
            new(bold ? "NotoSans-Bold" : "NotoSans-Regular");

        public byte[]? GetFont(string faceName)
        {
            var asm = Assembly.GetExecutingAssembly();
            var name = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith($"{faceName}.ttf", StringComparison.Ordinal));
            if (name is null) return null;
            using var s = asm.GetManifestResourceStream(name)!;
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
    }
}
