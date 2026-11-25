using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Chia sẻ công khai trang sổ tay có thời hạn (TEST-228).</summary>
public class WikiShareRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 25, 3, 0, 0, TimeSpan.Zero);
    // Hết ngày giờ Việt Nam (UTC+7) = 0 giờ hôm sau giờ VN
    private static DateTimeOffset EndOfDay(DateOnly d) => new DateTimeOffset(d.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(7)).ToUniversalTime();

    [Theory]
    [InlineData(false, true, null)]
    [InlineData(true, true, 403)]   // token AI dù là quản lý
    [InlineData(true, false, 403)]
    [InlineData(false, false, 403)] // thành viên thường
    public void ManageDenial(bool byToken, bool canManage, int? status) =>
        Assert.Equal(status, WikiShareRules.ManageDenial(canManage, byToken)?.Status);

    [Fact]
    public void ManageDenial_token_message_mentions_web() =>
        Assert.Equal(WikiShareRules.NoAgent, WikiShareRules.ManageDenial(true, true)!.Message);

    [Theory]
    [InlineData(true, false, false, true)]
    [InlineData(false, true, false, true)]  // người tạo (đã không còn là quản lý) vẫn xem nhật ký
    [InlineData(false, false, false, false)]
    [InlineData(true, true, true, false)]   // token AI
    public void CanSeeViews(bool canManage, bool isCreator, bool byToken, bool expected) =>
        Assert.Equal(expected, WikiShareRules.CanSeeViews(canManage, isCreator, byToken));

    [Theory]
    [InlineData(null, 7)]
    [InlineData(1, 1)]
    [InlineData(7, 7)]
    [InlineData(30, 30)]
    public void ExpiresAt_days(int? days, int expected)
    {
        var (at, err) = WikiShareRules.ExpiresAt(days, null, Now, EndOfDay);
        Assert.Null(err);
        Assert.Equal(Now.AddDays(expected), at);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(90)]
    [InlineData(-1)]
    public void ExpiresAt_days_not_in_list(int days)
    {
        var (at, err) = WikiShareRules.ExpiresAt(days, null, Now, EndOfDay);
        Assert.Null(at);
        Assert.NotNull(err);
    }

    [Fact]
    public void ExpiresAt_custom_date_is_end_of_that_day_office_time()
    {
        var (at, err) = WikiShareRules.ExpiresAt(null, new DateOnly(2026, 12, 1), Now, EndOfDay);
        Assert.Null(err);
        Assert.Equal(new DateTimeOffset(2026, 12, 1, 17, 0, 0, TimeSpan.Zero), at); // 0 giờ 2/12 giờ VN
    }

    [Fact]
    public void ExpiresAt_today_allowed_past_not()
    {
        Assert.NotNull(WikiShareRules.ExpiresAt(null, new DateOnly(2026, 11, 25), Now, EndOfDay).At); // hết hôm nay vẫn sau now
        Assert.NotNull(WikiShareRules.ExpiresAt(null, new DateOnly(2026, 11, 24), Now, EndOfDay).Error);
    }

    [Fact]
    public void ExpiresAt_max_90_days()
    {
        // now = 10 giờ 25/11 giờ VN; now + 90 ngày = 10 giờ 23/2. Hết ngày 22/2 (0 giờ 23/2) → được; hết ngày 23/2 → quá
        Assert.Null(WikiShareRules.ExpiresAt(null, new DateOnly(2027, 2, 22), Now, EndOfDay).Error);
        Assert.Equal("Hạn tối đa 90 ngày", WikiShareRules.ExpiresAt(null, new DateOnly(2027, 2, 23), Now, EndOfDay).Error);
    }

    [Fact]
    public void ExpiresAt_both_is_error() =>
        Assert.NotNull(WikiShareRules.ExpiresAt(7, new DateOnly(2026, 12, 1), Now, EndOfDay).Error);

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("abc", true)]
    [InlineData("abcd", false)]
    public void PasswordError(string? pw, bool error) => Assert.Equal(error, WikiShareRules.PasswordError(pw) is not null);

    [Fact]
    public void PasswordError_too_long() => Assert.NotNull(WikiShareRules.PasswordError(new string('x', 101)));

    [Theory]
    [InlineData(1, false, true, true, WikiShareState.Active)]
    [InlineData(-1, false, true, true, WikiShareState.Gone)]  // hết hạn
    [InlineData(0, false, true, true, WikiShareState.Gone)]   // đúng lúc hết hạn
    [InlineData(1, true, true, true, WikiShareState.Gone)]    // thu hồi
    [InlineData(1, false, false, true, WikiShareState.Gone)]  // dự án đóng
    [InlineData(1, false, true, false, WikiShareState.Gone)]  // trang gốc bị xoá
    public void State(int hours, bool revoked, bool active, bool root, WikiShareState expected) =>
        Assert.Equal(expected, WikiShareRules.State(Now.AddHours(hours), revoked ? Now : null, Now, active, root));

    [Fact]
    public void UnlockExpires_24h_but_not_after_link()
    {
        Assert.Equal(Now.AddHours(24), WikiShareRules.UnlockExpires(Now, Now.AddDays(7)));
        Assert.Equal(Now.AddHours(3), WikiShareRules.UnlockExpires(Now, Now.AddHours(3)));
    }

    [Theory]
    [InlineData(0, 0, false)]
    [InlineData(4, 29, false)]
    [InlineData(5, 0, true)]
    [InlineData(0, 30, true)]
    public void UnlockBlocked(int ip, int link, bool expected) => Assert.Equal(expected, WikiShareRules.UnlockBlocked(ip, link));

    [Theory]
    [InlineData(true, false, null, true)]       // mở lần đầu
    [InlineData(false, true, null, true)]       // thiết bị mới
    [InlineData(false, false, null, false)]     // thiết bị cũ
    [InlineData(false, true, -30, false)]       // thiết bị mới nhưng vừa báo 30 phút trước
    [InlineData(false, true, -60, true)]        // đủ 1 giờ
    public void ShouldNotify(bool first, bool newDevice, int? notifiedMinutesAgo, bool expected) =>
        Assert.Equal(expected, WikiShareRules.ShouldNotify(first, newDevice, notifiedMinutesAgo is { } m ? Now.AddMinutes(m) : null, Now));

    private static readonly Guid Root = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid A = Guid.Parse("00000000-0000-0000-0000-00000000000a");
    private static readonly Guid B = Guid.Parse("00000000-0000-0000-0000-00000000000b");
    private static readonly Guid A1 = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Other = Guid.Parse("00000000-0000-0000-0000-0000000000ff");

    private static readonly WikiShareNode[] Tree =
    [
        new(Other, null, 0, "Khác"),
        new(Root, null, 1, "Gốc"),
        new(B, Root, 1, "B"),
        new(A, Root, 0, "A"),
        new(A1, A, 0, "A1"),
    ];

    [Fact]
    public void SharedPages_root_only() => Assert.Equal([Root], WikiShareRules.SharedPages(Root, false, Tree).Select(x => x.Id));

    [Fact]
    public void SharedPages_with_children_in_tree_order() =>
        Assert.Equal([Root, A, A1, B], WikiShareRules.SharedPages(Root, true, Tree).Select(x => x.Id));

    [Fact]
    public void SharedPages_deleted_parent_hides_subtree() =>
        // A đã xoá mềm → không có trong danh sách → A1 cũng ẩn
        Assert.Equal([Root, B], WikiShareRules.SharedPages(Root, true, Tree.Where(x => x.Id != A).ToList()).Select(x => x.Id));

    [Fact]
    public void SharedPages_missing_root_is_empty() => Assert.Empty(WikiShareRules.SharedPages(Guid.NewGuid(), true, Tree));

    [Theory]
    [InlineData("https://office.lokid.me/projects/01a1cb11-4644-716a-bf4d-8ab17b2f159b?tab=wiki&page=00000000-0000-0000-0000-00000000000a", true)]
    [InlineData("/projects/01a1cb11-4644-716a-bf4d-8ab17b2f159b?page=00000000-0000-0000-0000-00000000000a&tab=wiki", true)]
    [InlineData("?tab=wiki&page=00000000-0000-0000-0000-00000000000a", true)]
    [InlineData("https://example.com/?page=00000000-0000-0000-0000-00000000000a", false)]
    [InlineData("/projects/x?tab=wiki", false)]
    public void WikiPageIdOf(string url, bool isWiki) => Assert.Equal(isWiki ? A : null, WikiShareRules.WikiPageIdOf(url));

    [Fact]
    public void RewriteLinks_shared_public_other_marked_external_kept()
    {
        var md = $"Xem [A](/projects/p?tab=wiki&page={A}) và [Khác](https://office.lokid.me/projects/p?tab=wiki&page={Other} \"tiêu đề\") " +
                 "hoặc [web](https://example.com) ![ảnh](https://cdn.example.com/a.png)";
        var r = WikiShareRules.RewriteLinks(md, new HashSet<Guid> { Root, A }, id => $"/w/T?page={id}");
        Assert.Equal($"Xem [A](/w/T?page={A}) và [Khác]({WikiShareRules.NotSharedHref} \"tiêu đề\") hoặc [web](https://example.com) ![ảnh](https://cdn.example.com/a.png)", r);
        Assert.DoesNotContain(Other.ToString(), r);
    }

    [Fact]
    public void RewriteLinks_no_links_unchanged() => Assert.Equal("Không có link", WikiShareRules.RewriteLinks("Không có link", new HashSet<Guid>(), _ => ""));

    [Theory]
    [InlineData(null, null)]
    [InlineData("  ", null)]
    [InlineData(" Anh\r\nBình\t ", "Anh Bình")]
    public void OneLine(string? s, string? expected) => Assert.Equal(expected, WikiShareRules.OneLine(s));
}
