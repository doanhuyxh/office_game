using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Tests;

/// <summary>TEST-12: tạo token AI cần xác nhận lại trừ khi vừa đăng nhập; mật khẩu tạm bị chặn ở server.</summary>
public class ReauthRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Recent_login_within_window_skips_reauth()
    {
        Assert.True(ReauthRules.IsRecentLogin(Now.AddMinutes(-1), Now));
        Assert.True(ReauthRules.IsRecentLogin(Now.AddMinutes(-10), Now));
    }

    [Fact]
    public void Old_missing_or_future_login_requires_reauth()
    {
        Assert.False(ReauthRules.IsRecentLogin(Now.AddMinutes(-11), Now));
        Assert.False(ReauthRules.IsRecentLogin(null, Now));
        Assert.False(ReauthRules.IsRecentLogin(Now.AddMinutes(5), Now)); // đồng hồ lệch / dữ liệu sai → không tin
    }

    [Theory]
    [InlineData("/api/auth/change-password", true)]
    [InlineData("/api/auth/logout", true)]
    [InlineData("/api/auth/me", true)]
    [InlineData("/api/employees", false)]
    [InlineData("/api/auth/access-tokens", false)]
    [InlineData("/health", true)]
    public void Password_change_gate_only_allows_exempt_routes(string path, bool allowed) =>
        Assert.Equal(allowed, TwoFactorPolicy.IsExempt(path));
}
