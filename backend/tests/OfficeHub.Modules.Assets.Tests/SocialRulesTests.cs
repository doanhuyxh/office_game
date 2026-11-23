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
        Assert.Equal(["pages_manage_posts", "pages_read_engagement", "business_management", "pages_read_user_content", "pages_manage_engagement"], missing);
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

    // ---------------- TEST-206: bài viết hiện có của Fanpage ----------------

    [Fact]
    public void PostsSyncTooSoon_OneMinuteCooldown()
    {
        Assert.False(SocialRules.PostsSyncTooSoon(null, Now));
        Assert.True(SocialRules.PostsSyncTooSoon(Now.AddSeconds(-59), Now));
        Assert.False(SocialRules.PostsSyncTooSoon(Now.AddMinutes(-1), Now));
        Assert.Equal(100, SocialRules.PagePostsLimit);
    }

    [Fact]
    public void CanViewPage_HrOrActiveHolder()
    {
        var other = Guid.NewGuid();
        Assert.True(SocialRules.CanViewPage(true, null, SocialAccountStatus.Disabled, null));
        Assert.True(SocialRules.CanViewPage(false, Emp, SocialAccountStatus.Active, Emp));
        Assert.False(SocialRules.CanViewPage(false, Emp, SocialAccountStatus.Disabled, Emp));
        Assert.False(SocialRules.CanViewPage(false, other, SocialAccountStatus.Active, Emp));
        Assert.False(SocialRules.CanViewPage(false, null, SocialAccountStatus.Active, null));
    }

    [Fact]
    public void RequiredPermissions_IncludeReadUserContentForPostSync() =>
        Assert.True(SocialRules.IsRequiredPermission("pages_read_user_content"));

    // ---------------- Sửa bài đã hẹn (TEST-208) ----------------

    private static (SocialTargetStatus, int) T(SocialTargetStatus s, int attempts = 0) => (s, attempts);

    [Fact]
    public void CannotEditPost_OnlyWhenNothingSentYet()
    {
        Assert.Null(SocialRules.CannotEditPost([T(SocialTargetStatus.Pending)]));
        Assert.Null(SocialRules.CannotEditPost([T(SocialTargetStatus.Pending), T(SocialTargetStatus.Cancelled)]));
        Assert.Null(SocialRules.CannotEditPost([T(SocialTargetStatus.Pending), T(SocialTargetStatus.Cancelled, 1)]));
    }

    [Theory]
    [InlineData(SocialTargetStatus.Publishing, 1, "đang được đăng")]
    [InlineData(SocialTargetStatus.Published, 1, "đã gửi lên Facebook")]
    [InlineData(SocialTargetStatus.Failed, 3, "đã gửi lên Facebook")]
    [InlineData(SocialTargetStatus.Pending, 1, "chờ thử lại")]
    public void CannotEditPost_SentOrRetrying_Blocked(SocialTargetStatus other, int attempts, string reason)
    {
        var why = SocialRules.CannotEditPost([T(SocialTargetStatus.Pending), T(other, attempts)]);
        Assert.NotNull(why);
        Assert.Contains(reason, why);
    }

    [Fact]
    public void CannotEditPost_NoPendingTarget_Blocked()
    {
        Assert.Equal("Bài không còn trang nào đang chờ đăng", SocialRules.CannotEditPost([T(SocialTargetStatus.Cancelled)]));
        Assert.Equal("Bài không còn trang nào đang chờ đăng", SocialRules.CannotEditPost([]));
    }

    [Fact]
    public void CanEditAuthor_AuthorOrHrOnly()
    {
        var author = Guid.NewGuid();
        Assert.True(SocialRules.CanEditAuthor(false, author, author));
        Assert.True(SocialRules.CanEditAuthor(true, Guid.NewGuid(), author));
        Assert.False(SocialRules.CanEditAuthor(false, Guid.NewGuid(), author)); // người giữ BM không phải tác giả: chỉ huỷ
    }

    // ---------------- Xoá mềm bài ở /social/facebook (TEST-214) ----------------

    [Theory]
    [InlineData(new[] { SocialTargetStatus.Published })]
    [InlineData(new[] { SocialTargetStatus.Published, SocialTargetStatus.Failed })] // lỗi một phần
    [InlineData(new[] { SocialTargetStatus.Failed })]
    [InlineData(new[] { SocialTargetStatus.Cancelled })]
    [InlineData(new[] { SocialTargetStatus.Published, SocialTargetStatus.Cancelled })]
    [InlineData(new SocialTargetStatus[0])]
    public void CannotDeletePost_FinishedPost_Allowed(SocialTargetStatus[] targets) => Assert.Null(SocialRules.CannotDeletePost(targets));

    [Fact]
    public void CannotDeletePost_PendingOrPublishing_Blocked()
    {
        Assert.Contains("Huỷ", SocialRules.CannotDeletePost([SocialTargetStatus.Published, SocialTargetStatus.Pending]));
        Assert.Contains("đang được đăng", SocialRules.CannotDeletePost([SocialTargetStatus.Publishing, SocialTargetStatus.Failed]));
    }

    [Fact]
    public void CanDeletePost_AuthorOrHrOnly()
    {
        var author = Guid.NewGuid();
        Assert.True(SocialRules.CanDeletePost(false, author, author));
        Assert.True(SocialRules.CanDeletePost(true, Guid.NewGuid(), author)); // HR / Quản trị viên (IsHr gồm admin)
        Assert.False(SocialRules.CanDeletePost(false, Guid.NewGuid(), author)); // người giữ BM không phải tác giả → 403
    }

    [Fact]
    public void CanViewDeletedPosts_HrOnly()
    {
        Assert.True(SocialRules.CanViewDeletedPosts(true));
        Assert.False(SocialRules.CanViewDeletedPosts(false));
    }

    // ---------------- Ẩn / hiện / xoá bài của Fanpage (TEST-211) ----------------

    [Fact]
    public void CanModeratePagePost_HolderHrAdminOnly()
    {
        var other = Guid.NewGuid();
        Assert.True(SocialRules.CanModeratePagePost(true, null, SocialAccountStatus.Active, Emp)); // HR / Quản trị viên (IsHr gồm admin)
        Assert.True(SocialRules.CanModeratePagePost(true, null, SocialAccountStatus.Disabled, null));
        Assert.True(SocialRules.CanModeratePagePost(false, Emp, SocialAccountStatus.Active, Emp)); // người đang giữ BM
        Assert.False(SocialRules.CanModeratePagePost(false, Emp, SocialAccountStatus.Disabled, Emp)); // BM ngừng dùng: người giữ cũ không còn quyền
        Assert.False(SocialRules.CanModeratePagePost(false, other, SocialAccountStatus.Active, Emp)); // người ngoài
        Assert.False(SocialRules.CanModeratePagePost(false, null, SocialAccountStatus.Active, null));
    }

    [Fact]
    public void CannotModeratePagePost_NeedsActivePageTokenAndNotDeleted()
    {
        Assert.Null(SocialRules.CannotModeratePagePost(true, true, false));
        Assert.Contains("đã bị xoá", SocialRules.CannotModeratePagePost(true, true, true));
        Assert.Contains("không còn trong BM", SocialRules.CannotModeratePagePost(false, true, false));
        Assert.Contains("Chưa có quyền", SocialRules.CannotModeratePagePost(true, false, false));
    }

    [Theory]
    [InlineData(404, null, null, true)]
    [InlineData(400, 100, 33, true)]
    [InlineData(400, 100, null, false)]
    [InlineData(400, 10, null, false)]
    [InlineData(400, 190, null, false)]
    public void IsPostGone_404Or100Subcode33(int? http, int? code, int? subcode, bool expected) =>
        Assert.Equal(expected, SocialRules.IsPostGone(http, code, subcode));

    [Fact]
    public void ModerationError_AddsPermissionHintForPermissionCodes()
    {
        Assert.Contains("pages_manage_posts", SocialRules.ModerationError(10, "x"));
        Assert.Contains("pages_manage_posts", SocialRules.ModerationError(200, "x"));
        Assert.DoesNotContain("pages_manage_posts", SocialRules.ModerationError(100, "Invalid parameter"));
        Assert.Contains("Invalid parameter", SocialRules.ModerationError(100, "Invalid parameter"));
    }
    // ---------------- Bình luận + trả lời bình luận (TEST-212) ----------------

    [Fact]
    public void RequiredPermissions_IncludeManageEngagementForReplies() =>
        Assert.True(SocialRules.IsRequiredPermission("pages_manage_engagement"));

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   \n\t ", false)]
    [InlineData("Cảm ơn bạn!", true)]
    [InlineData("  a  ", true)]
    public void ValidateReply_NotBlank(string? message, bool ok) =>
        Assert.Equal(ok, SocialRules.ValidateReply(message) is null);

    [Fact]
    public void ValidateReply_Max8000AfterTrim()
    {
        Assert.Null(SocialRules.ValidateReply(new string('a', 8000)));
        Assert.Null(SocialRules.ValidateReply("  " + new string('a', 8000) + "  "));
        Assert.Contains("8", SocialRules.ValidateReply(new string('a', 8001)));
    }

    [Fact]
    public void IsDuplicateReply_SameMessageWithin30Seconds()
    {
        var at = new DateTimeOffset(2026, 11, 22, 3, 0, 0, TimeSpan.Zero);
        Assert.True(SocialRules.IsDuplicateReply("Cảm ơn", at, "Cảm ơn", at.AddSeconds(1)));
        Assert.True(SocialRules.IsDuplicateReply("Cảm ơn", at, "  Cảm ơn \n", at.AddSeconds(29))); // khác khoảng trắng đầu / cuối vẫn trùng
        Assert.False(SocialRules.IsDuplicateReply("Cảm ơn", at, "Cảm ơn", at.AddSeconds(30))); // hết 30 giây: gửi được
        Assert.False(SocialRules.IsDuplicateReply("Cảm ơn", at, "Cảm ơn bạn", at.AddSeconds(5))); // nội dung khác: gửi được
        Assert.False(SocialRules.IsDuplicateReply("cảm ơn", at, "Cảm ơn", at.AddSeconds(5))); // phân biệt hoa thường
    }

    [Fact]
    public void CannotReply_ChecksPageTokenAndEngagementPermission()
    {
        var granted = new[] { P("pages_manage_engagement"), P("pages_show_list") };
        Assert.Null(SocialRules.CannotReply(true, true, false, SocialTokenStatus.Valid, granted));
        Assert.Null(SocialRules.CannotReply(true, true, false, SocialTokenStatus.Valid, null)); // chưa lấy được danh sách quyền: cứ gửi
        Assert.Contains("pages_manage_engagement", SocialRules.CannotReply(true, true, false, SocialTokenStatus.Valid, [P("pages_show_list")]));
        Assert.Contains("pages_manage_engagement",
            SocialRules.CannotReply(true, true, false, SocialTokenStatus.Valid, [P("pages_manage_engagement", "declined")]));
        Assert.Contains("đã bị xoá", SocialRules.CannotReply(true, true, true, SocialTokenStatus.Valid, granted));
        Assert.Contains("không còn trong BM", SocialRules.CannotReply(false, true, false, SocialTokenStatus.Valid, granted));
        Assert.Contains("Chưa có quyền", SocialRules.CannotReply(true, false, false, SocialTokenStatus.Valid, granted));
        Assert.Contains("Token BM đang lỗi", SocialRules.CannotReply(true, true, false, SocialTokenStatus.Invalid, granted));
    }

    [Fact]
    public void CommentError_NamesEngagementPermissionForPermissionCodes()
    {
        Assert.Contains("Token thiếu quyền pages_manage_engagement", SocialRules.CommentError(200, "x"));
        Assert.Contains("Token thiếu quyền pages_manage_engagement", SocialRules.CommentError(10, "x"));
        Assert.Equal("Facebook từ chối: Invalid parameter", SocialRules.CommentError(100, "Invalid parameter"));
    }

    [Theory]
    [InlineData("123_456", true)]
    [InlineData("789", true)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("123/456", false)]
    [InlineData("me", false)]
    [InlineData("1_2?fields=access_token", false)]
    public void IsCommentId_DigitsAndUnderscoreOnly(string? id, bool ok) => Assert.Equal(ok, SocialRules.IsCommentId(id));
}
