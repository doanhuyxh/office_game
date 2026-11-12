using System.IO.Compression;
using System.Text;
using OfficeHub.BuildingBlocks.Documents;
using OfficeHub.BuildingBlocks.Storage;

namespace OfficeHub.Modules.Documents.Tests;

/// <summary>TEST-13: kiểu file do server quyết, chữ ký đầu file, chống zip bomb.</summary>
public class FileTypesTests
{
    [Theory]
    [InlineData("a.pdf", "application/pdf", true)]
    [InlineData("a.PNG", "image/png", true)]
    [InlineData("a.mp4", "video/mp4", true)]
    [InlineData("a.svg", FileTypes.OctetStream, false)]   // SVG chứa script → không bao giờ inline
    [InlineData("a.html", "text/plain", true)]            // HTML phục vụ dạng chữ thuần → chỉ hiện mã nguồn, không dựng trang
    [InlineData("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", false)]
    public void Content_type_and_inline_from_extension(string name, string type, bool inline)
    {
        Assert.Equal(type, FileTypes.ContentTypeFor(name));
        Assert.Equal(inline, FileTypes.IsInlineSafe(FileTypes.ContentTypeFor(name)));
    }

    [Theory]
    [InlineData("setup.exe", false)]
    [InlineData("run.bat", false)]
    [InlineData("x.unknownext", false)]
    [InlineData("bao-cao.xlsx", true)]
    [InlineData("thiet-ke.fig", true)]
    public void Allowlist(string name, bool ok) => Assert.Equal(ok, FileTypes.IsAllowed(name));

    [Fact]
    public void Signature_must_match_extension()
    {
        byte[] png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
        byte[] exe = [0x4D, 0x5A, 0x90, 0x00];
        Assert.True(FileTypes.SignatureMatches("a.png", png));
        Assert.False(FileTypes.SignatureMatches("a.png", exe));           // .exe đổi tên thành .png
        Assert.False(FileTypes.SignatureMatches("a.pdf", exe));
        Assert.True(FileTypes.SignatureMatches("a.pdf", "%PDF-1.7"u8));
        Assert.True(FileTypes.SignatureMatches("a.docx", [0x50, 0x4B, 0x03, 0x04]));
        Assert.False(FileTypes.SignatureMatches("a.jpg", []));            // rỗng
        Assert.True(FileTypes.SignatureMatches("ghi-chu.txt", exe));      // văn bản: không kiểm chữ ký
        Assert.True(FileTypes.StreamMatches(new MemoryStream(png), "png"));
        Assert.False(FileTypes.StreamMatches(new MemoryStream(exe), ".jpg"));
    }

    private static MemoryStream Zip(Action<ZipArchive> fill)
    {
        var ms = new MemoryStream();
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true)) fill(z);
        ms.Position = 0;
        return ms;
    }

    [Fact]
    public void Zip_guard_accepts_normal_file_and_rewinds()
    {
        using var ms = Zip(z => { using var w = new StreamWriter(z.CreateEntry("word/document.xml").Open()); w.Write("<w:document>xin chào</w:document>"); });
        ZipGuard.Check(ms);
        Assert.Equal(0, ms.Position);
    }

    [Fact]
    public void Zip_guard_rejects_bomb()
    {
        // 20 MB số 0 nén còn vài chục KB → tỉ lệ > 200
        using var ms = Zip(z =>
        {
            using var s = z.CreateEntry("bomb.xml", CompressionLevel.SmallestSize).Open();
            var zeros = new byte[1024 * 1024];
            for (var i = 0; i < 20; i++) s.Write(zeros);
        });
        Assert.Throws<InvalidDataException>(() => ZipGuard.Check(ms));
    }

    [Fact]
    public void Zip_guard_rejects_too_many_entries()
    {
        using var ms = Zip(z => { for (var i = 0; i <= ZipGuard.MaxEntries; i++) z.CreateEntry($"f{i}.txt"); });
        Assert.Throws<InvalidDataException>(() => ZipGuard.Check(ms));
    }

    [Fact]
    public void Zip_guard_rejects_non_zip() =>
        Assert.Throws<InvalidDataException>(() => ZipGuard.Check(new MemoryStream(Encoding.UTF8.GetBytes("không phải zip"))));
}
