using OfficeHub.Realtime.Screens;

namespace OfficeHub.Realtime.Tests;

/// <summary>Bot chiếu màn hình: nhận diện ảnh theo chữ ký file, giới hạn cỡ, base64 / data URL, lượt chiếu theo phòng.</summary>
public class BotScreensTests
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 16];
    private static readonly byte[] Webp = "RIFF\0\0\0\0WEBPVP8 "u8.ToArray();

    [Fact]
    public void Detects_image_by_signature_not_by_name()
    {
        Assert.Equal("image/png", BotScreens.DetectImage(Png));
        Assert.Equal("image/jpeg", BotScreens.DetectImage(Jpeg));
        Assert.Equal("image/webp", BotScreens.DetectImage(Webp));
        Assert.Null(BotScreens.DetectImage("<svg onload=alert(1)>"u8));
        Assert.Null(BotScreens.DetectImage("GIF89a"u8));
    }

    [Fact]
    public void Decodes_base64_and_data_url()
    {
        Assert.Equal(Png, BotScreens.DecodeImage(Convert.ToBase64String(Png), out _));
        Assert.Equal(Jpeg, BotScreens.DecodeImage("data:image/jpeg;base64," + Convert.ToBase64String(Jpeg), out _));
    }

    [Theory]
    [InlineData("", "Thiếu ảnh màn hình")]
    [InlineData("không phải base64!!", "Ảnh không phải base64 hợp lệ")]
    [InlineData("PHN2Zz4=", "Chỉ nhận ảnh PNG, JPEG hoặc WebP")] // "<svg>"
    public void Rejects_bad_input(string input, string error)
    {
        Assert.Null(BotScreens.DecodeImage(input, out var err));
        Assert.Equal(error, err);
    }

    [Fact]
    public void Rejects_too_large()
    {
        var big = new byte[BotScreens.MaxBytes + 1];
        Png.CopyTo(big, 0);
        Assert.Null(BotScreens.DecodeImage(Convert.ToBase64String(big), out var err));
        Assert.Contains("lớn quá", err);
    }

    [Fact]
    public void Same_bot_keeps_token_another_bot_replaces_and_url_changes_per_frame()
    {
        var s = new BotScreens();
        var a = s.Begin("bot-a", "meeting-small");
        Assert.Same(a, s.Begin("bot-a", "meeting-small"));
        a.Frame = new BotFrame(Png, "image/png", 1, DateTimeOffset.UnixEpoch);
        var u1 = BotScreens.FrameUrl(a);
        a.Frame = a.Frame with { Version = 2 };
        Assert.NotEqual(u1, BotScreens.FrameUrl(a));
        Assert.StartsWith("/rt/screens/meeting-small/", u1);
        Assert.Equal(32, a.Token.Length);
        var b = s.Begin("bot-b", "meeting-small");
        Assert.NotSame(a, b);
        Assert.NotEqual(a.Token, b.Token);
    }

    [Fact]
    public void Cleared_room_blocks_bot_for_one_minute()
    {
        var s = new BotScreens();
        var t = DateTimeOffset.UnixEpoch;
        s.MarkCleared("r", t);
        Assert.True(s.RecentlyCleared("r", t.AddSeconds(59)));
        Assert.False(s.RecentlyCleared("r", t.AddSeconds(61)));
        Assert.False(s.RecentlyCleared("other", t));
    }

    [Fact]
    public void Markdown_is_trimmed_and_control_chars_removed()
    {
        Assert.Equal("# Tiến độ\n- [x] Xong\tok", BotScreens.CleanMarkdown("  # Tiến độ\n- [x] Xong\tok\u0007\u0000 ", out var err));
        Assert.Null(err);
    }

    [Theory]
    [InlineData("")]
    [InlineData("  \n\t ")]
    [InlineData(null)]
    public void Markdown_empty_rejected(string? input)
    {
        Assert.Null(BotScreens.CleanMarkdown(input, out var err));
        Assert.Equal("Thiếu nội dung trình bày (content)", err);
    }

    [Fact]
    public void Markdown_too_long_rejected()
    {
        Assert.NotNull(BotScreens.CleanMarkdown(new string('a', BotScreens.MaxMarkdownChars), out _));
        Assert.Null(BotScreens.CleanMarkdown(new string('a', BotScreens.MaxMarkdownChars + 1), out var err));
        Assert.Contains("Nội dung dài quá", err);
    }
}
