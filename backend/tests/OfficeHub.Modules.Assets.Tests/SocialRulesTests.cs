using OfficeHub.Modules.Assets.Domain;

namespace OfficeHub.Modules.Assets.Tests;

public class SocialRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 3, 0, 0, TimeSpan.Zero);
    private static readonly Guid Emp = Guid.NewGuid();

    [Fact]
    public void CannotAssign_Rules()
    {
        Assert.Null(SocialRules.CannotAssign(SocialAccountStatus.Active, null, true));
        Assert.Equal("Tài khoản đã ngừng dùng", SocialRules.CannotAssign(SocialAccountStatus.Disabled, null, true));
        Assert.Equal("Tài khoản đang giao cho người khác, hãy thu hồi trước", SocialRules.CannotAssign(SocialAccountStatus.Active, Emp, true));
        Assert.Equal("Nhân viên đã nghỉ việc hoặc không tồn tại", SocialRules.CannotAssign(SocialAccountStatus.Active, null, false));
    }

    [Fact]
    public void CannotDisable_RequiresReturnFirst()
    {
        Assert.Null(SocialRules.CannotDisable(null));
        Assert.NotNull(SocialRules.CannotDisable(Emp));
    }

    [Fact]
    public void CanPublish_HrOrHolderOfActiveAccount()
    {
        Assert.True(SocialRules.CanPublish(true, null, SocialAccountStatus.Active, null));
        Assert.True(SocialRules.CanPublish(false, Emp, SocialAccountStatus.Active, Emp));
        Assert.False(SocialRules.CanPublish(false, Emp, SocialAccountStatus.Active, Guid.NewGuid()));
        Assert.False(SocialRules.CanPublish(false, null, SocialAccountStatus.Active, null));
        Assert.False(SocialRules.CanPublish(true, null, SocialAccountStatus.Disabled, null));
        Assert.False(SocialRules.CanPublish(false, Emp, SocialAccountStatus.Disabled, Emp));
    }

    [Theory]
    [InlineData("a.JPG", 1000, SocialMediaKind.Image, "image/jpeg", null)]
    [InlineData("a.png", 10L * 1024 * 1024, SocialMediaKind.Image, "image/png", null)]
    [InlineData("a.webp", 10L * 1024 * 1024 + 1, SocialMediaKind.Image, "image/webp", "Ảnh tối đa 10 MB")]
    [InlineData("clip.mp4", 500L * 1024 * 1024, SocialMediaKind.Video, "video/mp4", null)]
    [InlineData("clip.mov", 1024L * 1024 * 1024 + 1, SocialMediaKind.Video, "video/quicktime", "Video tối đa 1 GB")]
    [InlineData("a.gif", 0, SocialMediaKind.Image, "image/gif", "Tệp rỗng")]
    public void ClassifyMedia(string name, long size, SocialMediaKind kind, string type, string? error)
    {
        var r = SocialRules.ClassifyMedia(name, size);
        Assert.Equal(kind, r.Kind);
        Assert.Equal(type, r.ContentType);
        Assert.Equal(error, r.Error);
    }

    [Theory]
    [InlineData("a.exe")]
    [InlineData("a.pdf")]
    [InlineData("noext")]
    public void ClassifyMedia_RejectsOtherTypes(string name) => Assert.NotNull(SocialRules.ClassifyMedia(name, 10).Error);

    private static List<string> Fields(string? msg, string? link, int pages, SocialMediaKind[] media, DateTimeOffset? at = null) =>
        [.. SocialRules.ValidatePost(msg, link, pages, media, at, Now).Select(e => e.Field)];

    [Fact]
    public void ValidatePost_Ok()
    {
        Assert.Empty(Fields("Xin chào", null, 1, []));
        Assert.Empty(Fields("", "https://example.com", 2, []));
        Assert.Empty(Fields(null, null, 1, [SocialMediaKind.Image, SocialMediaKind.Image]));
        Assert.Empty(Fields("Video", null, 1, [SocialMediaKind.Video]));
        Assert.Empty(Fields("Hẹn", null, 1, [], Now.AddMinutes(5)));
    }

    [Fact]
    public void ValidatePost_Errors()
    {
        Assert.Contains("message", Fields("  ", null, 1, []));
        Assert.Contains("message", Fields(new string('a', SocialRules.MaxMessageLength + 1), null, 1, []));
        Assert.Contains("link", Fields("x", "ftp://a.b", 1, []));
        Assert.Contains("link", Fields("x", "không phải link", 1, []));
        Assert.Contains("link", Fields("x", "https://a.b", 1, [SocialMediaKind.Image]));
        Assert.Contains("pageIds", Fields("x", null, 0, []));
        Assert.Contains("pageIds", Fields("x", null, SocialRules.MaxPages + 1, []));
        Assert.Contains("mediaIds", Fields("x", null, 1, [SocialMediaKind.Video, SocialMediaKind.Image]));
        Assert.Contains("mediaIds", Fields("x", null, 1, [SocialMediaKind.Video, SocialMediaKind.Video]));
        Assert.Contains("mediaIds", Fields("x", null, 1, Enumerable.Repeat(SocialMediaKind.Image, SocialRules.MaxImages + 1).ToArray()));
        Assert.Contains("scheduledAt", Fields("x", null, 1, [], Now.AddMinutes(1)));
        Assert.Contains("scheduledAt", Fields("x", null, 1, [], Now.AddMinutes(-10)));
        Assert.Contains("scheduledAt", Fields("x", null, 1, [], Now.AddDays(181)));
    }

    [Fact]
    public void PostStatus_Aggregates()
    {
        const SocialTargetStatus P = SocialTargetStatus.Pending, R = SocialTargetStatus.Publishing, D = SocialTargetStatus.Published,
            F = SocialTargetStatus.Failed, C = SocialTargetStatus.Cancelled;
        Assert.Equal(SocialPostStatus.Scheduled, SocialRules.PostStatus([P, D]));
        Assert.Equal(SocialPostStatus.Publishing, SocialRules.PostStatus([P, R]));
        Assert.Equal(SocialPostStatus.Published, SocialRules.PostStatus([D, D, C]));
        Assert.Equal(SocialPostStatus.PartiallyFailed, SocialRules.PostStatus([D, F]));
        Assert.Equal(SocialPostStatus.Failed, SocialRules.PostStatus([F, C]));
        Assert.Equal(SocialPostStatus.Cancelled, SocialRules.PostStatus([C, C]));
        Assert.Equal(SocialPostStatus.Cancelled, SocialRules.PostStatus([]));
    }

    [Theory]
    [InlineData(400, 4, true)]
    [InlineData(400, 32, true)]
    [InlineData(500, null, true)]
    [InlineData(429, null, true)]
    [InlineData(400, 190, false)]
    [InlineData(400, 100, false)]
    [InlineData(403, 200, false)]
    public void IsTransient(int http, int? code, bool expected) => Assert.Equal(expected, SocialRules.IsTransient(http, code));

    [Fact]
    public void TokenErrors_OnlyInvalidSession()
    {
        Assert.True(SocialRules.IsTokenError(190));
        Assert.True(SocialRules.IsTokenError(102));
        Assert.False(SocialRules.IsTokenError(200));
        Assert.False(SocialRules.IsTokenError(null));
    }

    [Fact]
    public void Backoff_Grows() => Assert.True(SocialRules.Backoff(2) > SocialRules.Backoff(1));

    [Fact]
    public void MediaKey_IsSafe()
    {
        var id = Guid.Parse("0193a5a0-0000-7000-8000-000000000001");
        Assert.Equal($"assets/social/202611/{id:N}/Anh__ep_1.jpg", SocialRules.MediaKey(Now, id, "Anh đep 1.jpg"));
        Assert.Equal($"assets/social/202611/{id:N}/file", SocialRules.MediaKey(Now, id, "đđ"));
    }

    [Theory]
    [InlineData("https://www.facebook.com/123/posts/456", "https://www.facebook.com/123/posts/456")]
    [InlineData("/123/videos/789/", "https://www.facebook.com/123/videos/789/")]
    [InlineData("123/videos/789/", "https://www.facebook.com/123/videos/789/")]
    [InlineData(null, null)]
    public void AbsolutePermalink(string? input, string? expected) => Assert.Equal(expected, SocialRules.AbsolutePermalink(input));
}
