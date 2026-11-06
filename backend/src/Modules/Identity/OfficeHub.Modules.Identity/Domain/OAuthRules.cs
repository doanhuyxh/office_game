using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace OfficeHub.Modules.Identity.Domain;

/// <summary>Quy tắc OAuth 2.1 thuần (không DB) — có unit test trong tests/OfficeHub.Modules.Identity.Tests.</summary>
public static partial class OAuthRules
{
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(2);
    public static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromHours(1);
    /// <summary>Refresh token trượt 30 ngày; grant sống tối đa 1 năm rồi phải đồng ý lại.</summary>
    public static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(30);
    public static readonly TimeSpan GrantMaxLifetime = TimeSpan.FromDays(365);
    public const int MaxRedirectUris = 10;

    private static readonly HashSet<string> ForbiddenSchemes =
        ["http", "javascript", "data", "file", "vbscript", "about", "blob", "ftp", "ws", "wss", "chrome", "view-source"];

    public static bool IsLoopback(Uri u) =>
        u.Scheme == Uri.UriSchemeHttp && (u.Host is "localhost" or "127.0.0.1" or "[::1]" || u.IsLoopback);

    /// <summary>
    /// https, http loopback (ứng dụng chạy trên máy: Claude Code, Codex…) hoặc scheme riêng của ứng dụng (cursor://…).
    /// Không fragment, không userinfo, ≤ 2000 ký tự.
    /// </summary>
    public static bool IsValidRedirectUri(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2000) return false;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var u)) return false;
        if (!string.IsNullOrEmpty(u.Fragment) || !string.IsNullOrEmpty(u.UserInfo)) return false;
        if (u.Scheme == Uri.UriSchemeHttps) return !string.IsNullOrEmpty(u.Host);
        if (IsLoopback(u)) return true;
        return SchemeRegex().IsMatch(u.Scheme) && !ForbiddenSchemes.Contains(u.Scheme);
    }

    /// <summary>Khớp tuyệt đối; riêng http loopback bỏ qua cổng (RFC 8252 §7.3 — ứng dụng chọn cổng ngẫu nhiên lúc chạy).</summary>
    public static bool RedirectMatches(IEnumerable<string> registered, string requested)
    {
        if (!Uri.TryCreate(requested, UriKind.Absolute, out var req)) return false;
        foreach (var r in registered)
        {
            if (string.Equals(r, requested, StringComparison.Ordinal)) return true;
            if (Uri.TryCreate(r, UriKind.Absolute, out var reg) && IsLoopback(reg) && IsLoopback(req)
                && reg.Host == req.Host && reg.AbsolutePath == req.AbsolutePath && reg.Query == req.Query)
                return true;
        }
        return false;
    }

    /// <summary>code_challenge S256 = base64url(SHA-256) = 43 ký tự.</summary>
    public static bool IsValidChallenge(string? challenge) => challenge is not null && ChallengeRegex().IsMatch(challenge);

    /// <summary>RFC 7636: verifier 43–128 ký tự [A-Za-z0-9-._~]; so sánh thời gian hằng.</summary>
    public static bool VerifyPkce(string? verifier, string challenge)
    {
        if (verifier is null || !VerifierRegex().IsMatch(verifier)) return false;
        var computed = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(computed), Encoding.ASCII.GetBytes(challenge));
    }

    /// <summary>resource (RFC 8707) phải thuộc chính máy chủ này (cùng scheme + host + cổng với App__BaseUrl).</summary>
    public static bool ResourceAllowed(string? resource, string baseUrl)
    {
        if (string.IsNullOrWhiteSpace(resource)) return true;
        return Uri.TryCreate(resource, UriKind.Absolute, out var r) && Uri.TryCreate(baseUrl, UriKind.Absolute, out var b)
            && string.Equals(r.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase)
            && string.Equals(r.Authority, b.Authority, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Thêm tham số vào redirect_uri (giữ query sẵn có).</summary>
    public static string AppendQuery(string uri, IEnumerable<KeyValuePair<string, string?>> values)
    {
        var parts = values.Where(v => v.Value is not null).Select(v => $"{Uri.EscapeDataString(v.Key)}={Uri.EscapeDataString(v.Value!)}");
        var q = string.Join('&', parts);
        if (q.Length == 0) return uri;
        return uri + (uri.Contains('?') ? "&" : "?") + q;
    }

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static string NewSecret(string prefix) => prefix + Base64Url(RandomNumberGenerator.GetBytes(32));

    public static DateTimeOffset NextRefreshExpiry(DateTimeOffset now, DateTimeOffset grantCreatedAt)
    {
        var sliding = now + RefreshLifetime;
        var cap = grantCreatedAt + GrantMaxLifetime;
        return sliding < cap ? sliding : cap;
    }

    [GeneratedRegex("^[a-z][a-z0-9+.-]*$")] private static partial Regex SchemeRegex();
    [GeneratedRegex("^[A-Za-z0-9_-]{43}$")] private static partial Regex ChallengeRegex();
    [GeneratedRegex("^[A-Za-z0-9._~-]{43,128}$")] private static partial Regex VerifierRegex();
}
