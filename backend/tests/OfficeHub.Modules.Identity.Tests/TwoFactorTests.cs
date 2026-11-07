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
    public void Required_for_admin_and_hr_only(string[] roles, bool required) =>
        Assert.Equal(required, TwoFactorPolicy.IsRequiredFor(roles));

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
