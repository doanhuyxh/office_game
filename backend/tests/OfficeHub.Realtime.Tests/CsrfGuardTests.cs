using OfficeHub.BuildingBlocks.Security;
using static OfficeHub.BuildingBlocks.Security.CsrfGuard;

namespace OfficeHub.Realtime.Tests;

public class CsrfGuardTests
{
    private static readonly string[] Allowed = ["https://office.lokid.me", "http://localhost:5080"];

    [Theory]
    [InlineData("same-origin", Verdict.Allow)]
    [InlineData("none", Verdict.Allow)]
    [InlineData("SAME-ORIGIN", Verdict.Allow)]
    [InlineData("same-site", Verdict.Block)]   // subdomain khác cùng tên miền — SameSite=Lax không chặn được
    [InlineData("cross-site", Verdict.Block)]
    public void SecFetchSite_quyết_định(string site, Verdict expected) =>
        Assert.Equal(expected, Decide(site, origin: "https://evil.example", referer: null, Allowed));

    [Fact]
    public void SecFetchSite_same_origin_thắng_Origin_lệch_qua_proxy() =>
        // Vite dev proxy: Origin = :5173, Api thấy Host :5080 — trình duyệt vẫn báo same-origin
        Assert.Equal(Verdict.Allow, Decide("same-origin", "http://localhost:5173", null, Allowed));

    [Theory]
    [InlineData("https://office.lokid.me", Verdict.Allow)]
    [InlineData("https://OFFICE.lokid.me", Verdict.Allow)]
    [InlineData("https://office.lokid.me:443", Verdict.Allow)]
    [InlineData("http://office.lokid.me", Verdict.Block)]     // khác scheme
    [InlineData("https://chat.lokid.me", Verdict.Block)]
    [InlineData("https://office.lokid.me.evil.com", Verdict.Block)]
    [InlineData("null", Verdict.Block)]
    public void Origin_khi_không_có_SecFetchSite(string origin, Verdict expected) =>
        Assert.Equal(expected, Decide(null, origin, null, Allowed));

    [Theory]
    [InlineData("https://office.lokid.me/payroll?x=1", Verdict.Allow)]
    [InlineData("https://evil.example/a", Verdict.Block)]
    [InlineData("không-phải-url", Verdict.Block)]
    public void Referer_khi_không_có_Origin(string referer, Verdict expected) =>
        Assert.Equal(expected, Decide(null, null, referer, Allowed));

    [Fact]
    public void Không_có_header_nào_là_client_ngoài_trình_duyệt() =>
        Assert.Equal(Verdict.Allow, Decide(null, null, null, Allowed));
}
