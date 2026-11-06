using System.Security.Cryptography;
using System.Text;
using OfficeHub.Modules.Identity.Domain;

namespace OfficeHub.Modules.Identity.Tests;

public class OAuthRulesTests
{
    [Theory]
    [InlineData("https://claude.ai/api/mcp/auth_callback")]
    [InlineData("http://localhost:33418/callback")]
    [InlineData("http://127.0.0.1:5000/cb")]
    [InlineData("cursor://anysphere.cursor-retrieval/oauth/user-officehub/callback")]
    public void Accepts_valid_redirects(string uri) => Assert.True(OAuthRules.IsValidRedirectUri(uri));

    [Theory]
    [InlineData("http://evil.example.com/cb")]          // http chỉ cho loopback
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hi")]
    [InlineData("file:///etc/passwd")]
    [InlineData("https://claude.ai/cb#frag")]
    [InlineData("https://user:pass@claude.ai/cb")]
    [InlineData("/relative/cb")]
    [InlineData("")]
    public void Rejects_bad_redirects(string uri) => Assert.False(OAuthRules.IsValidRedirectUri(uri));

    [Fact]
    public void Redirect_match_is_exact_except_loopback_port()
    {
        string[] reg = ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:1234/callback"];
        Assert.True(OAuthRules.RedirectMatches(reg, "https://claude.ai/api/mcp/auth_callback"));
        Assert.False(OAuthRules.RedirectMatches(reg, "https://claude.ai/api/mcp/auth_callback/x"));
        Assert.False(OAuthRules.RedirectMatches(reg, "https://claude.ai.evil.com/api/mcp/auth_callback"));
        Assert.True(OAuthRules.RedirectMatches(reg, "http://127.0.0.1:59999/callback"));   // RFC 8252: cổng ngẫu nhiên
        Assert.False(OAuthRules.RedirectMatches(reg, "http://127.0.0.1:59999/other"));
        Assert.False(OAuthRules.RedirectMatches(reg, "http://localhost:59999/callback"));  // khác host
    }

    [Fact]
    public void Pkce_s256_roundtrip()
    {
        var verifier = OAuthRules.Base64Url(RandomNumberGenerator.GetBytes(32)); // 43 ký tự
        var challenge = OAuthRules.Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        Assert.True(OAuthRules.IsValidChallenge(challenge));
        Assert.True(OAuthRules.VerifyPkce(verifier, challenge));
        Assert.False(OAuthRules.VerifyPkce(verifier + "x", challenge));
        Assert.False(OAuthRules.VerifyPkce("short", challenge));
        Assert.False(OAuthRules.VerifyPkce(null, challenge));
        Assert.False(OAuthRules.IsValidChallenge("plain-text-challenge"));
    }

    [Fact]
    public void Resource_must_be_this_server()
    {
        const string b = "https://office.example.com";
        Assert.True(OAuthRules.ResourceAllowed(null, b));
        Assert.True(OAuthRules.ResourceAllowed("https://office.example.com/mcp", b));
        Assert.False(OAuthRules.ResourceAllowed("https://other.example.com/mcp", b));
        Assert.False(OAuthRules.ResourceAllowed("http://office.example.com/mcp", b));
    }

    [Fact]
    public void Append_query_keeps_existing_and_skips_nulls()
    {
        Assert.Equal("https://a.b/cb?x=1&code=abc&state=s%20t",
            OAuthRules.AppendQuery("https://a.b/cb?x=1", [new("code", "abc"), new("state", "s t"), new("iss", null)]));
        Assert.Equal("https://a.b/cb?error=access_denied", OAuthRules.AppendQuery("https://a.b/cb", [new("error", "access_denied")]));
    }

    [Fact]
    public void Refresh_expiry_slides_but_caps_at_grant_max()
    {
        var created = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal(created.AddDays(30), OAuthRules.NextRefreshExpiry(created, created));
        var late = created.AddDays(350);
        Assert.Equal(created.AddDays(365), OAuthRules.NextRefreshExpiry(late, created));
    }
}
