using System.Collections.Concurrent;

namespace OfficeHub.Api;

/// <summary>
/// Trang Hệ thống: link (tài liệu API / log / hộp thư) có nhúng được vào iframe trong OfficeHub không — để hiện nút "Xem trong trang".
/// Đọc header của trang đích: <c>X-Frame-Options</c> (DENY / SAMEORIGIN) và CSP <c>frame-ancestors</c>. Đường dẫn tương đối (cùng site,
/// vd /api/system/docs/ — nginx đặt bản SAMEORIGIN) → nhúng được. Không gọi được → chưa biết (null). Kết quả giữ 10 phút.
/// </summary>
public static class EmbedCheck
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 5 })
    {
        Timeout = TimeSpan.FromSeconds(4),
        DefaultRequestHeaders = { { "User-Agent", "OfficeHub-EmbedCheck" } },
    };
    private static readonly ConcurrentDictionary<string, (bool? Ok, string? Note, DateTimeOffset At)> Cache = new();

    public static async Task<(bool? Embeddable, string? Note)> CheckAsync(string? url, string? appBaseUrl, TimeProvider clock, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(url)) return (null, null);
        if (url.StartsWith('/')) return (true, null);
        if (!Uri.TryCreate(url, UriKind.Absolute, out var target) || (target.Scheme != "https" && target.Scheme != "http")) return (false, null);
        var now = clock.GetUtcNow();
        if (Cache.TryGetValue(url, out var c) && now - c.At < TimeSpan.FromMinutes(10)) return (c.Ok, c.Note);
        (bool? Ok, string? Note) r;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, target);
            using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if ((int)res.StatusCode >= 500) r = (null, $"Trang đang lỗi (HTTP {(int)res.StatusCode}) — chưa kiểm tra được có cho nhúng không.");
            else
            {
                var finalUri = res.RequestMessage?.RequestUri ?? target;
                var xfo = res.Headers.TryGetValues("X-Frame-Options", out var x) ? string.Join(",", x) : null;
                var csp = res.Headers.TryGetValues("Content-Security-Policy", out var p) ? string.Join(";", p) : null;
                r = Decide(xfo, csp, finalUri, appBaseUrl);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            r = (null, "Không kết nối được tới trang này để kiểm tra — thử xem trong trang hoặc mở tab mới.");
        }
        Cache[url] = (r.Ok, r.Note, now);
        return r;
    }

    /// <summary>Quyết định theo header (thuần — test được). CSP frame-ancestors ưu tiên hơn X-Frame-Options (như trình duyệt).</summary>
    public static (bool? Ok, string? Note) Decide(string? xFrameOptions, string? csp, Uri target, string? appBaseUrl)
    {
        var app = Uri.TryCreate(appBaseUrl, UriKind.Absolute, out var a) ? a : null;
        var sameOrigin = app is not null && Uri.Compare(app, target, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0;
        var fa = csp?.Split(';').Select(d => d.Trim()).FirstOrDefault(d => d.StartsWith("frame-ancestors", StringComparison.OrdinalIgnoreCase));
        if (fa is not null)
        {
            var sources = fa.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1).Select(s => s.Trim().ToLowerInvariant()).ToList();
            if (sources.Contains("'none'")) return (false, "Trang này chặn nhúng vào web khác (CSP frame-ancestors 'none') — chỉ mở được ở tab mới.");
            if (sources.Contains("*")) return (true, null);
            if (sameOrigin && sources.Contains("'self'")) return (true, null);
            if (app is not null && sources.Any(s => s.TrimEnd('/') == app.GetLeftPart(UriPartial.Authority).ToLowerInvariant() || s == $"*.{app.Host}" || s == app.Host)) return (true, null);
            return (false, "Trang này chỉ cho một số site được nhúng (CSP frame-ancestors) — chỉ mở được ở tab mới.");
        }
        var xfo = xFrameOptions?.Trim().ToUpperInvariant();
        if (xfo == "DENY") return (false, "Trang này chặn nhúng vào web khác (X-Frame-Options: DENY) — chỉ mở được ở tab mới.");
        if (xfo == "SAMEORIGIN" && !sameOrigin) return (false, "Trang này chỉ cho chính nó nhúng (X-Frame-Options: SAMEORIGIN) — chỉ mở được ở tab mới.");
        return (true, null);
    }
}
