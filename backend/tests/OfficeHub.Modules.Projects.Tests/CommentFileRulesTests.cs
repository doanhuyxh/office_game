using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Tệp đính kèm bình luận việc (TEST-153).</summary>
public class CommentFileRulesTests
{
    [Theory]
    [InlineData("anh.png", "image/png", 1024, true)]
    [InlineData("bao-cao.pdf", "application/pdf", 20L * 1024 * 1024, true)]
    [InlineData("anh.png", "image/png", 11L * 1024 * 1024, false)]           // ảnh > 10 MB
    [InlineData("du-lieu.zip", "application/zip", 26L * 1024 * 1024, false)] // tệp > 25 MB
    [InlineData("virus.exe", "application/octet-stream", 100, false)]
    [InlineData("script.sh", "application/octet-stream", 100, false)]
    [InlineData("la.xyz", "application/octet-stream", 100, false)]           // ngoài danh sách đuôi được phép
    [InlineData("", "application/octet-stream", 100, false)]
    [InlineData("rong.txt", "text/plain", 0, false)]
    public void ValidateUpload(string name, string type, long size, bool ok) =>
        Assert.Equal(ok, CommentFileRules.ValidateUpload(name, type, size).Count == 0);

    [Fact]
    public void Svg_is_not_an_inline_image()
    {
        Assert.False(CommentFileRules.IsImage("application/octet-stream")); // .svg → octet-stream theo FileTypes, luôn tải về
        Assert.True(CommentFileRules.IsImage("image/webp"));
        Assert.Equal(CommentFileRules.MaxFileSize, CommentFileRules.MaxSizeOf("application/pdf"));
    }

    [Fact]
    public void Comment_needs_text_or_files()
    {
        Assert.Contains(CommentFileRules.ValidateComment("  ", 0), e => e.Field == "content");
        Assert.Empty(CommentFileRules.ValidateComment(null, 1));
        Assert.Empty(CommentFileRules.ValidateComment("ok", 0));
        Assert.Contains(CommentFileRules.ValidateComment(new string('a', 3001), 0), e => e.Field == "content");
        Assert.Contains(CommentFileRules.ValidateComment("ok", 6), e => e.Field == "uploadIds");
    }

    [Fact]
    public void File_key_lives_under_projects_comments()
    {
        var now = new DateTimeOffset(2026, 11, 17, 3, 0, 0, TimeSpan.Zero);
        var id = Guid.Parse("0193a000-0000-7000-8000-000000000001");
        Assert.Equal($"projects/comments/2026/11/{id:N}/Anh-chup-man-hinh.png", CommentFileRules.FileKey(now, id, "Ảnh chụp màn hình.png"));
        Assert.Equal("file", CommentFileRules.SafeKeyName("---"));
    }

    [Fact]
    public void Clean_file_name_strips_path_and_control_chars()
    {
        Assert.Equal("a.png", CommentFileRules.CleanFileName(@"C:\tmp\a.png"));
        Assert.Equal("b.png", CommentFileRules.CleanFileName("../../b\u0001.png"));
        Assert.Equal("", CommentFileRules.CleanFileName(null));
    }

    [Fact]
    public void Preview_uses_text_or_first_file()
    {
        Assert.Equal("xin chào", CommentFileRules.Preview("xin chào", [("a.png", true)]));
        Assert.Equal("[Ảnh] a.png +1", CommentFileRules.Preview("", [("a.png", true), ("b.pdf", false)]));
        Assert.Equal("[Tệp] b.pdf", CommentFileRules.Preview("", [("b.pdf", false)]));
        Assert.EndsWith("…", CommentFileRules.Preview(new string('x', 300), []));
    }

    [Fact]
    public void Bot_quota()
    {
        Assert.True(CommentFileRules.QuotaLeft(CommentFileRules.BotUploadsPerHour - 1));
        Assert.False(CommentFileRules.QuotaLeft(CommentFileRules.BotUploadsPerHour));
    }
}
