using System.Reflection;
using PdfSharp.Fonts;

namespace OfficeHub.BuildingBlocks.Pdf;

/// <summary>
/// Font cho PDFsharp (Noto Sans Regular / Bold, OFL, nhúng trong BuildingBlocks) — container Alpine không có font hệ thống, cần đủ dấu
/// tiếng Việt. <see cref="GlobalFontSettings.FontResolver"/> là biến TOÀN TIẾN TRÌNH nên mọi module vẽ PDF (ký hợp đồng, đóng dấu tài liệu)
/// phải dùng chung resolver này, không tự đặt resolver riêng. Họ font: <see cref="Family"/>.
/// </summary>
public static class PdfFonts
{
    public const string Family = "Noto Sans";
    private static int _init;

    public static void Ensure()
    {
        if (Interlocked.Exchange(ref _init, 1) == 1) return;
        GlobalFontSettings.FontResolver ??= new EmbeddedFontResolver();
    }

    private sealed class EmbeddedFontResolver : IFontResolver
    {
        public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
            new(bold ? "NotoSans-Bold" : "NotoSans-Regular");

        public byte[]? GetFont(string faceName)
        {
            var asm = typeof(PdfFonts).Assembly;
            var name = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith($"{faceName}.ttf", StringComparison.Ordinal));
            if (name is null) return null;
            using var s = asm.GetManifestResourceStream(name)!;
            using var ms = new MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
    }
}
