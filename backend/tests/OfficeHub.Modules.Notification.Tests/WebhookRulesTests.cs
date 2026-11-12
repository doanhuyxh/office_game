using System.Net;
using System.Security.Cryptography;
using System.Text;
using OfficeHub.Modules.Notification.Domain;

namespace OfficeHub.Modules.Notification.Tests;

public class WebhookRulesTests
{
    [Theory]
    [InlineData("https://agent.example.com/hooks/officehub", null)]
    [InlineData("  https://agent.example.com/x?y=1  ", null)]
    [InlineData("http://agent.example.com/x", "URL webhook phải bắt đầu bằng https://")]
    [InlineData("ftp://agent.example.com", "URL webhook phải bắt đầu bằng https://")]
    [InlineData("https://user:pw@agent.example.com", "URL không được chứa tên đăng nhập / mật khẩu")]
    [InlineData("https://agent.example.com/#x", "URL không được có phần #")]
    [InlineData("https://localhost/x", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("https://127.0.0.1/x", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("https://10.0.0.5/x", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("https://192.168.1.10/x", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("https://169.254.169.254/latest/meta-data", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("https://[::1]/x", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("https://printer.local/x", "Không gửi webhook tới địa chỉ nội bộ")]
    [InlineData("", "Nhập URL webhook")]
    [InlineData("not a url", "URL không hợp lệ")]
    public void Url_validation_in_production(string url, string? expected) => Assert.Equal(expected, WebhookRules.UrlError(url, allowPrivate: false));

    [Fact]
    public void Development_allows_http_localhost()
    {
        Assert.Null(WebhookRules.UrlError("http://localhost:5299/hook", allowPrivate: true));
        Assert.Equal("URL không được có phần #", WebhookRules.UrlError("http://localhost/#a", allowPrivate: true));
    }

    [Theory]
    [InlineData("8.8.8.8", true)]
    [InlineData("1.1.1.1", true)]
    [InlineData("172.15.0.1", true)]
    [InlineData("172.16.0.1", false)]
    [InlineData("172.31.255.255", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("::ffff:8.8.8.8", true)]
    [InlineData("fd00::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("2606:4700:4700::1111", true)]
    // TEST-22: IPv6 nhúng IPv4 nội bộ
    [InlineData("64:ff9b::a00:1", false)]        // NAT64 → 10.0.0.1
    [InlineData("64:ff9b::808:808", true)]       // NAT64 → 8.8.8.8
    [InlineData("2002:a00:1::1", false)]         // 6to4 → 10.0.0.1
    [InlineData("2002:c0a8:101::1", false)]      // 6to4 → 192.168.1.1
    [InlineData("::127.0.0.1", false)]           // IPv4-compatible
    [InlineData("::169.254.169.254", false)]     // metadata cloud
    [InlineData("2001:0:4136:e378::1", false)]   // Teredo
    [InlineData("::1", false)]
    public void Public_ip(string ip, bool expected) => Assert.Equal(expected, WebhookRules.IsPublic(IPAddress.Parse(ip)));

    [Fact]
    public void Signature_is_hmac_of_timestamp_dot_body()
    {
        const string secret = "whsec_test", body = "{\"a\":1}";
        var expected = "sha256=" + Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes("1700000000." + body)));
        Assert.Equal(expected, WebhookRules.Sign(secret, 1700000000, body));
        Assert.NotEqual(expected, WebhookRules.Sign(secret, 1700000001, body));
    }

    [Fact]
    public void New_secret_is_random_and_url_safe()
    {
        var a = WebhookRules.NewSecret();
        Assert.StartsWith("whsec_", a);
        Assert.NotEqual(a, WebhookRules.NewSecret());
        Assert.DoesNotContain('+', a);
        Assert.DoesNotContain('/', a);
        Assert.True(a.Length >= 48);
    }

    [Fact]
    public void Retry_schedule()
    {
        var now = new DateTimeOffset(2026, 11, 11, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal(now.AddMinutes(1), WebhookRules.NextAttempt(1, now));
        Assert.Equal(now.AddMinutes(60), WebhookRules.NextAttempt(4, now));
        Assert.Null(WebhookRules.NextAttempt(WebhookRules.MaxAttempts, now));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData(500, true)]
    [InlineData(503, true)]
    [InlineData(429, true)]
    [InlineData(408, true)]
    [InlineData(400, false)]
    [InlineData(404, false)]
    [InlineData(410, false)]
    public void Retryable(int? status, bool expected) => Assert.Equal(expected, WebhookRules.Retryable(status));
}
