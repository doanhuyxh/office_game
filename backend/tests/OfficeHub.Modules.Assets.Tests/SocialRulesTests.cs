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

    private static SocialTokenPermission P(string name, string status = "granted") => new(name, status);

    [Fact]
    public void MissingPermissions_AllGranted_Empty()
    {
        var perms = SocialRules.RequiredPermissions.Select(r => P(r.Permission)).Append(P("public_profile")).ToList();
        Assert.Empty(SocialRules.MissingPermissions(perms));
    }

    [Fact]
    public void MissingPermissions_AbsentOrNotGranted()
    {
        var perms = new[] { P("pages_show_list"), P("pages_manage_posts", "declined"), P("pages_read_engagement", "expired") };
        var missing = SocialRules.MissingPermissions(perms).Select(m => m.Permission).ToList();
        Assert.Equal(["pages_manage_posts", "pages_read_engagement", "business_management"], missing);
        Assert.All(SocialRules.MissingPermissions([]), m => Assert.False(string.IsNullOrWhiteSpace(m.Impact)));
        Assert.Equal(SocialRules.RequiredPermissions.Count, SocialRules.MissingPermissions([]).Count);
    }

    [Fact]
    public void RequiredPermissions_ForPostingAndSync()
    {
        foreach (var name in new[] { "pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management" })
            Assert.True(SocialRules.IsRequiredPermission(name));
        Assert.False(SocialRules.IsRequiredPermission("public_profile"));
    }

    [Fact]
    public void Permissions_RoundTrip_DedupSortLowercase()
    {
        var json = SocialRules.SerializePermissions([P("pages_show_list", "Granted"), P("ads_read", "declined"), P("pages_show_list", "declined"), P(" ", "granted")]);
        var back = SocialRules.ParsePermissions(json)!;
        Assert.Equal([P("ads_read", "declined"), P("pages_show_list", "granted")], back);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    public void ParsePermissions_EmptyOrBroken_Null(string? json) => Assert.Null(SocialRules.ParsePermissions(json));

    // ---------------- Kiểm tra token định kỳ (TEST-205) ----------------

    [Fact]
    public void TokenCheck_EveryFiveHours() => Assert.Equal(TimeSpan.FromHours(5), SocialRules.TokenCheckInterval);

    [Theory]
    [InlineData(SocialTokenStatus.None, true)]
    [InlineData(SocialTokenStatus.Valid, true)]
    [InlineData(SocialTokenStatus.Invalid, false)]
    public void TokenInvalidAlert_OnlyOnTransition(SocialTokenStatus before, bool expected) =>
        Assert.Equal(expected, SocialRules.ShouldAlertTokenInvalid(before));

    [Theory]
    [InlineData(400, 190, true)]
    [InlineData(400, 102, true)]
    [InlineData(403, 200, true)]
    [InlineData(500, 1, false)]
    [InlineData(400, 4, false)]
    [InlineData(429, null, false)]
    public void MarksTokenInvalid_NotOnTransient(int http, int? code, bool expected) =>
        Assert.Equal(expected, SocialRules.MarksTokenInvalid(http, code));

    [Fact]
    public void TokenAlertRecipients_HolderHrAdmin_Deduplicated()
    {
        Guid holder = Guid.NewGuid(), hr = Guid.NewGuid(), both = Guid.NewGuid(), admin = Guid.NewGuid();
        var to = SocialRules.TokenAlertRecipients(holder, [hr, both, holder], [both, admin]);
        Assert.Equal([holder, hr, both, admin], to);
    }

    [Fact]
    public void TokenAlertRecipients_NoHolder_HrAndAdmin()
    {
        Guid hr = Guid.NewGuid(), admin = Guid.NewGuid();
        Assert.Equal([hr, admin], SocialRules.TokenAlertRecipients(null, [hr], [admin]));
        Assert.Empty(SocialRules.TokenAlertRecipients(null, [], []));
    }

    [Fact]
    public void Facebook_routes_and_notification_links_are_per_platform()
    {
        // TEST-207: mỗi nền tảng một tiền tố API + trang riêng; link chuông trỏ trang Facebook / sub-tab Facebook BM (khớp FE PATHS.socialFacebook).
        Assert.Equal("/social/facebook", SocialRules.FacebookApiPrefix);
        Assert.Equal("/social/facebook", SocialRules.FacebookPostsLink);
        Assert.Equal("/assets?tab=social&platform=facebook", SocialRules.FacebookAccountsLink);
    }
}
