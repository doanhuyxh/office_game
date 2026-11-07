using OfficeHub.Api;

namespace OfficeHub.Architecture.Tests;

/// <summary>Trang Hệ thống: quyết định link có nhúng được vào iframe trong OfficeHub không (nút "Xem trong trang").</summary>
public class EmbedCheckTests
{
    private const string App = "https://office.lokid.me";
    private static readonly Uri Ext = new("https://logs.lokid.me/");

    [Fact]
    public void No_headers_means_embeddable() => Assert.True(EmbedCheck.Decide(null, null, Ext, App).Ok);

    [Theory]
    [InlineData("DENY", null)]
    [InlineData("SAMEORIGIN", null)]
    [InlineData(null, "default-src 'self'; frame-ancestors 'none'")]
    [InlineData(null, "frame-ancestors 'self'")]
    [InlineData("DENY", "frame-ancestors https://other.example")]
    public void Blocking_headers_are_respected(string? xfo, string? csp)
    {
        var (ok, note) = EmbedCheck.Decide(xfo, csp, Ext, App);
        Assert.False(ok);
        Assert.Contains("tab mới", note);
    }

    [Theory]
    [InlineData("DENY", "frame-ancestors https://office.lokid.me")] // CSP thắng X-Frame-Options
    [InlineData(null, "frame-ancestors *")]
    [InlineData(null, "frame-ancestors *.office.lokid.me office.lokid.me")]
    public void Allowed_by_csp(string? xfo, string? csp) => Assert.True(EmbedCheck.Decide(xfo, csp, Ext, App).Ok);

    [Fact]
    public void Sameorigin_ok_only_for_same_site() =>
        Assert.True(EmbedCheck.Decide("SAMEORIGIN", "frame-ancestors 'self'", new Uri("https://office.lokid.me/x"), App).Ok);
}
