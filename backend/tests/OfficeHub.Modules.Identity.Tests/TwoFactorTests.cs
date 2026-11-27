using OfficeHub.BuildingBlocks.Configuration;
using System.Security.Claims;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Tests;

public class TwoFactorTests
{
    [Fact]
    public void Formats_key_in_lowercase_groups_of_four() =>
        Assert.Equal("abcd efgh ijkl mn", TwoFactorRules.FormatKey("ABCDEFGHIJKLMN"));

    [Fact]
    public void Builds_otpauth_uri_with_escaped_issuer_and_account()
    {
        var uri = TwoFactorRules.AuthenticatorUri("Office Hub", "an.nv@cty.vn", "abcd efgh");
        Assert.Equal("otpauth://totp/Office%20Hub:an.nv%40cty.vn?secret=ABCDEFGH&issuer=Office%20Hub&digits=6", uri);
    }

    [Theory]
    [InlineData("123 456", "123456")]
    [InlineData(" 123-456 ", "123456")]
    [InlineData(null, "")]
    public void Normalizes_totp_code(string? raw, string expected) => Assert.Equal(expected, TwoFactorRules.NormalizeCode(raw));

    [Theory]
    [InlineData("123456", true)]
    [InlineData("12345", false)]
    [InlineData("1234567", false)]
    [InlineData("12a456", false)]
    [InlineData("١٢٣٤٥٦", false)] // chữ số không phải ASCII
    public void Totp_format_is_six_ascii_digits(string code, bool ok) => Assert.Equal(ok, TwoFactorRules.IsTotpFormat(code));

    [Theory]
    [InlineData("bcdfg-hjkmn", "BCDFG-HJKMN")]
    [InlineData("BCDFGHJKMN", "BCDFG-HJKMN")]
    [InlineData(" bcdfg hjkmn ", "BCDFG-HJKMN")]
    [InlineData("abc", "ABC")]
    public void Normalizes_recovery_code_to_identity_format(string raw, string expected) =>
        Assert.Equal(expected, TwoFactorRules.NormalizeRecoveryCode(raw));

    [Theory]
    [InlineData(new[] { "admin" }, true)]
    [InlineData(new[] { "employee", "hr" }, true)]
    [InlineData(new[] { "HR" }, true)]
    [InlineData(new[] { "manager", "employee" }, false)]
    [InlineData(new string[0], false)]
    public void Default_scope_requires_admin_and_hr_only(string[] roles, bool required) =>
        Assert.Equal(required, TwoFactorPolicy.IsRequiredFor(roles, isBot: false, new TwoFactorSettings()));

    [Theory]
    // scope, vai trò, bot, bắt buộc?
    [InlineData(TwoFactorScopes.Managers, new[] { "manager", "employee" }, false, true)]
    [InlineData(TwoFactorScopes.Managers, new[] { "employee" }, false, false)]
    [InlineData(TwoFactorScopes.All, new[] { "employee" }, false, true)]
    [InlineData(TwoFactorScopes.All, new string[0], false, true)]
    // Bot: chỉ bắt buộc khi có admin / hr, phạm vi mở rộng không áp
    [InlineData(TwoFactorScopes.All, new[] { "employee" }, true, false)]
    [InlineData(TwoFactorScopes.Managers, new[] { "manager" }, true, false)]
    [InlineData(TwoFactorScopes.AdminHr, new[] { "hr" }, true, true)]
    [InlineData("la-lam", new[] { "manager" }, false, false)]
    public void Scope_extends_required_roles(string scope, string[] roles, bool isBot, bool required) =>
        Assert.Equal(required, TwoFactorPolicy.IsRequiredFor(roles, isBot, new TwoFactorSettings { Scope = scope }));

    [Fact]
    public void Cached_identity_recomputes_must_setup_claim_from_current_policy()
    {
        // Ảnh chụp cũ có claim must_setup_2fa (từ chính sách trước) — principal dựng lại phải theo chính sách hiện hành.
        var snap = new OfficeHub.Modules.Identity.Infrastructure.UserAuthSnapshot(Guid.NewGuid(), "stamp", true, false, false, null,
            TwoFactorEnabled: false, IsBot: false, ["manager", "employee"],
            [new("sub", "x"), new(ClaimNames.MustSetupTwoFactor, "true")], 0);
        static bool Must(System.Security.Claims.ClaimsIdentity id) => id.HasClaim(ClaimNames.MustSetupTwoFactor, "true");
        Assert.False(Must(snap.ToIdentity("t", "name", "role", new TwoFactorSettings())));
        Assert.True(Must(snap.ToIdentity("t", "name", "role", new TwoFactorSettings { Scope = TwoFactorScopes.Managers })));
        Assert.False(Must((snap with { TwoFactorEnabled = true }).ToIdentity("t", "name", "role", new TwoFactorSettings { Scope = TwoFactorScopes.All })));
    }

    [Theory]
    [InlineData("/api/auth/me")]
    [InlineData("/api/auth/me/")]
    [InlineData("/api/auth/logout")]
    [InlineData("/api/auth/change-password")]
    [InlineData("/api/auth/2fa/status")]
    [InlineData("/api/auth/2fa/setup")]
    [InlineData("/api/auth/2fa/enable")]
    [InlineData("/api/auth/login/2fa")]
    [InlineData("/health")]
    [InlineData("/rt/hub/office")]
    public void Exempt_paths(string path) => Assert.True(TwoFactorPolicy.IsExempt(path));

    [Theory]
    [InlineData("/api/org/employees")]
    [InlineData("/api/auth/access-tokens")]
    [InlineData("/api/auth/2fa/disable")]
    [InlineData("/api/auth/2fa/recovery-codes")]
    [InlineData("/api/auth/avatar")]
    [InlineData("/api/auth/me/role")]           // chỉ khớp chính xác, không theo tiền tố
    [InlineData("/api/auth/2fa/setup/../../org")]
    [InlineData("/api/system/info")]
    [InlineData("/API/ORG/EMPLOYEES")]
    public void Blocked_paths(string path) => Assert.False(TwoFactorPolicy.IsExempt(path));

    [Fact]
    public void Must_setup_reads_claim()
    {
        var yes = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimNames.MustSetupTwoFactor, "true")], "test"));
        var no = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimNames.FullName, "A")], "test"));
        Assert.True(yes.MustSetup());
        Assert.False(no.MustSetup());
    }
}
