using System.Net;
using OfficeHub.BuildingBlocks.Hosting;

namespace OfficeHub.Modules.Identity.Tests;

/// <summary>X-Forwarded-* chỉ được tin khi request tới từ mạng Docker / loopback (TEST-15).</summary>
public class TrustedProxyTests
{
    private static bool Trusted(string ip) =>
        HostingExtensions.TrustedProxyNetworks.Select(IPNetwork.Parse).Any(n => n.Contains(IPAddress.Parse(ip)));

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    [InlineData("172.18.0.5")]      // mạng compose mặc định
    [InlineData("192.168.32.4")]
    [InlineData("10.8.0.2")]
    public void Trusts_docker_and_loopback(string ip) => Assert.True(Trusted(ip));

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("203.0.113.10")]
    [InlineData("172.32.0.1")]      // ngoài 172.16.0.0/12
    [InlineData("2001:4860::8888")]
    public void Does_not_trust_public_addresses(string ip) => Assert.False(Trusted(ip));
}
