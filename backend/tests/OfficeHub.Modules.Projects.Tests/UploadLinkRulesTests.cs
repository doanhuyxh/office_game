using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Link tải tệp từ thiết bị khác cho bình luận việc (TEST-175).</summary>
public class UploadLinkRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 18, 3, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(null, 60)]
    [InlineData(15, 15)]
    [InlineData(60, 60)]
    [InlineData(1440, 1440)]
    public void Lifetime_allowed(int? minutes, int expected) =>
        Assert.Equal(TimeSpan.FromMinutes(expected), UploadLinkRules.Lifetime(minutes));

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(30)]
    [InlineData(10080)]
    [InlineData(-60)]
    public void Lifetime_rejects_other_values(int minutes) => Assert.Null(UploadLinkRules.Lifetime(minutes));

    [Fact]
    public void Token_is_random_43_char_base64url_and_only_hash_is_stored()
    {
        var a = UploadLinkRules.NewToken();
        var b = UploadLinkRules.NewToken();
        Assert.NotEqual(a, b);
        Assert.True(UploadLinkRules.LooksLikeToken(a));
        Assert.Equal(43, a.Length); // 32 byte
        var h = UploadLinkRules.Hash(a);
        Assert.Equal(64, h.Length);
        Assert.Equal(h, UploadLinkRules.Hash(a));
        Assert.NotEqual(h, UploadLinkRules.Hash(b));
        Assert.DoesNotContain(a, h);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")] // 44 ký tự
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")] // có '='
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/A")] // '/' không phải base64url
    public void Malformed_token_is_rejected(string? token) => Assert.False(UploadLinkRules.LooksLikeToken(token));

    [Fact]
    public void State_active_only_when_all_conditions_hold()
    {
        var exp = Now.AddHours(1);
        Assert.Equal(UploadLinkState.Active, UploadLinkRules.State(exp, null, Now, projectActive: true, creatorIsMember: true));
        Assert.Equal(UploadLinkState.Gone, UploadLinkRules.State(Now, null, Now, true, true));              // đúng lúc hết hạn
        Assert.Equal(UploadLinkState.Gone, UploadLinkRules.State(Now.AddMinutes(-1), null, Now, true, true)); // đã hết hạn
        Assert.Equal(UploadLinkState.Gone, UploadLinkRules.State(exp, Now.AddMinutes(-5), Now, true, true)); // thu hồi
        Assert.Equal(UploadLinkState.Gone, UploadLinkRules.State(exp, null, Now, projectActive: false, creatorIsMember: true));
        Assert.Equal(UploadLinkState.Gone, UploadLinkRules.State(exp, null, Now, projectActive: true, creatorIsMember: false));
    }

    [Theory]
    [InlineData(0, 0, true)]
    [InlineData(45, 4, true)]
    [InlineData(45, 5, false)]
    [InlineData(50, 0, false)]
    public void Files_per_link(int sent, int pending, bool ok) => Assert.Equal(ok, UploadLinkRules.FilesLeft(sent, pending));

    [Fact]
    public void User_agent_is_cleaned_and_cut()
    {
        Assert.Null(UploadLinkRules.CleanUserAgent(null));
        Assert.Null(UploadLinkRules.CleanUserAgent("  "));
        Assert.Equal("Mozilla/5.0 x", UploadLinkRules.CleanUserAgent("Mozilla/5.0\n x"));
        Assert.Equal(UploadLinkRules.MaxUserAgent, UploadLinkRules.CleanUserAgent(new string('a', 1000))!.Length);
    }
}
