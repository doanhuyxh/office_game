using OfficeHub.Modules.Chat.Domain;
using OfficeHub.Modules.Chat.Features;
using OfficeHub.Modules.Chat.Infrastructure;

namespace OfficeHub.Modules.Chat.Tests;

public class ChatRulesTests
{
    [Fact]
    public void Direct_pair_is_the_same_both_ways()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        Assert.Equal(ChatRules.DirectPair(a, b), ChatRules.DirectPair(b, a));
        var (low, high) = ChatRules.DirectPair(a, b);
        Assert.True(string.CompareOrdinal(low.ToString(), high.ToString()) <= 0);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("   \n ", null)]
    [InlineData("  xin chào  ", "xin chào")]
    public void Normalizes_text(string? input, string? expected) => Assert.Equal(expected, ChatRules.NormalizeText(input));

    [Fact]
    public void Message_needs_text_or_attachment() =>
        Assert.Contains(ChatRules.ValidateMessage(null, 0), e => e.Field == "text");

    [Fact]
    public void Attachment_only_message_is_valid() => Assert.Empty(ChatRules.ValidateMessage(null, 1));

    [Fact]
    public void Rejects_text_over_limit_and_too_many_files()
    {
        Assert.Contains(ChatRules.ValidateMessage(new string('a', ChatRules.MaxTextLength + 1), 0), e => e.Field == "text");
        Assert.Empty(ChatRules.ValidateMessage(new string('a', ChatRules.MaxTextLength), 0));
        Assert.Contains(ChatRules.ValidateMessage("x", ChatRules.MaxAttachments + 1), e => e.Field == "uploadIds");
        Assert.Empty(ChatRules.ValidateMessage("x", ChatRules.MaxAttachments));
    }

    [Theory]
    [InlineData("setup.exe")]
    [InlineData("run.BAT")]
    [InlineData("app.apk")]
    public void Blocks_executables(string name) =>
        Assert.Contains(ChatRules.ValidateUpload(name, "application/octet-stream", 100), e => e.Field == "fileName");

    [Fact]
    public void Upload_size_limits_differ_for_images_and_files()
    {
        Assert.Empty(ChatRules.ValidateUpload("a.png", "image/png", ChatRules.MaxImageSize));
        Assert.Contains(ChatRules.ValidateUpload("a.png", "image/png", ChatRules.MaxImageSize + 1), e => e.Field == "size");
        Assert.Empty(ChatRules.ValidateUpload("a.pdf", "application/pdf", ChatRules.MaxFileSize));
        Assert.Contains(ChatRules.ValidateUpload("a.pdf", "application/pdf", ChatRules.MaxFileSize + 1), e => e.Field == "size");
        Assert.Contains(ChatRules.ValidateUpload("a.pdf", "application/pdf", 0), e => e.Field == "size");
    }

    [Theory]
    [InlineData("image/jpeg", true)]
    [InlineData("IMAGE/PNG; charset=x", true)]
    [InlineData("image/svg+xml", false)] // SVG có thể chứa script → luôn coi là tệp tải về
    [InlineData("application/pdf", false)]
    [InlineData("", false)]
    public void Detects_inline_images(string contentType, bool expected) => Assert.Equal(expected, ChatRules.IsImage(contentType));

    [Fact]
    public void File_key_lives_under_chat_folder_and_is_safe()
    {
        var now = new DateTimeOffset(2026, 11, 7, 3, 0, 0, TimeSpan.Zero);
        var key = ChatRules.FileKey(now, Guid.Parse("11111111-2222-3333-4444-555555555555"), "Báo cáo tháng 11 (final).pdf");
        Assert.StartsWith("chat/2026/11/", key);
        Assert.DoesNotContain("documents", key);
        Assert.DoesNotContain(' ', key);
        Assert.EndsWith("Bao-cao-thang-11-final.pdf", key);
        Assert.DoesNotContain("..", ChatRules.FileKey(now, Guid.NewGuid(), "../../etc/passwd"));
    }

    [Fact]
    public void Cleans_file_names()
    {
        Assert.Equal("a.txt", ChatRules.CleanFileName("C:\\x\\y\\a.txt"));
        Assert.Equal("a.txt", ChatRules.CleanFileName("/etc/a.txt"));
        Assert.Equal("", ChatRules.CleanFileName(null));
    }

    [Theory]
    [InlineData("Nguyễn Đức", "nguyen duc")]
    [InlineData("ĐẶNG", "dang")]
    [InlineData(null, "")]
    public void Folds_vietnamese_for_search(string? input, string expected) => Assert.Equal(expected, ChatRules.Fold(input));

    [Fact]
    public void Preview_uses_text_then_attachment_and_truncates()
    {
        Assert.Equal("a b", ChatRules.Preview("a\nb", []));
        Assert.Equal("[Ảnh] x.png", ChatRules.Preview(null, [("x.png", true)]));
        Assert.Equal("[Tệp] x.pdf", ChatRules.Preview(null, [("x.pdf", false)]));
        var p = ChatRules.Preview(new string('a', 500), []);
        Assert.Equal(ChatRules.MaxPreviewLength, p.Length);
        Assert.EndsWith("…", p);
    }

    [Fact]
    public void Internal_key_comparison()
    {
        var key = new string('k', 40);
        Assert.True(InternalEndpoints.KeyMatches(key, key));
        Assert.False(InternalEndpoints.KeyMatches(key + "x", key));
        Assert.False(InternalEndpoints.KeyMatches("", key));
        Assert.False(InternalEndpoints.KeyMatches(null, key));
        Assert.False(InternalEndpoints.KeyMatches("anything", "")); // chưa cấu hình khoá → không bao giờ khớp
    }

    [Fact]
    public void Throttle_allows_one_message_per_second_per_user()
    {
        var clock = new ManualClock(new DateTimeOffset(2026, 11, 7, 3, 0, 0, TimeSpan.Zero));
        var throttle = new ChatThrottle(clock);
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        Assert.True(throttle.TryAcquire(a));
        Assert.False(throttle.TryAcquire(a));
        Assert.True(throttle.TryAcquire(b)); // người khác không bị ảnh hưởng
        clock.Advance(TimeSpan.FromMilliseconds(999));
        Assert.False(throttle.TryAcquire(a));
        clock.Advance(TimeSpan.FromMilliseconds(1));
        Assert.True(throttle.TryAcquire(a));
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }
}
