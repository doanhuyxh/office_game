using System.Text.Json;
using OfficeHub.BuildingBlocks.Auth;

namespace OfficeHub.Realtime.Auth;

public sealed class RealtimeSettings
{
    public const string Section = "Realtime";
    /// <summary>Địa chỉ nội bộ của OfficeHub.Api để kiểm tra phiên (dev: http://localhost:5080, Docker: http://api:8080).</summary>
    public string ApiBaseUrl { get; set; } = "http://localhost:5080";
    /// <summary>Chu kỳ kiểm tra lại phiên của người đang online (giây).</summary>
    public int SessionCheckSeconds { get; set; } = 30;
}

public enum SessionState { Valid, Invalid, Unknown }

/// <summary>
/// Realtime không đọc được dữ liệu tài khoản (ranh giới module) → hỏi OfficeHub.Api `GET /api/auth/me` bằng chính cookie
/// của người dùng. Api kiểm tra security stamp + IsActive ở mọi request, nên tài khoản bị khoá / đổi mật khẩu → 401.
/// Api không trả lời được → Unknown (cho qua, ghi log) để Api restart không đá cả văn phòng ra.
/// </summary>
public sealed class SessionValidator(IHttpClientFactory http, ILogger<SessionValidator> log)
{
    public const string HttpClientName = "officehub-api";

    /// <summary>Chỉ lấy cookie đăng nhập (kể cả bản bị chia nhỏ officehub.authC1, C2…) từ header Cookie.</summary>
    public static string? AuthCookieHeader(string? cookieHeader) =>
        cookieHeader is null ? null
        : string.Join("; ", cookieHeader.Split(';', StringSplitOptions.TrimEntries)
            .Where(c => c.StartsWith(AuthCookie.CookieName, StringComparison.Ordinal))) is { Length: > 0 } s ? s : null;

    public async Task<SessionState> CheckAsync(string? authCookie, CancellationToken ct = default) =>
        (await CheckWithLookAsync(authCookie, ct)).State;

    /// <summary>Như <see cref="CheckAsync"/>, kèm ngoại hình nhân vật (trường <c>avatar</c> của /api/auth/me, JSON gọn; null = mặc định).</summary>
    public async Task<(SessionState State, string? Look)> CheckWithLookAsync(string? authCookie, CancellationToken ct = default)
    {
        if (authCookie is null) return (SessionState.Invalid, null);
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
            req.Headers.Add("Cookie", authCookie);
            using var res = await http.CreateClient(HttpClientName).SendAsync(req, ct);
            if (res.IsSuccessStatusCode) return (SessionState.Valid, LookFromMe(await res.Content.ReadAsStringAsync(ct)));
            if ((int)res.StatusCode is 401 or 403) return (SessionState.Invalid, null);
            log.LogWarning("Kiểm tra phiên: Api trả {Status}", (int)res.StatusCode);
            return (SessionState.Unknown, null);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning("Kiểm tra phiên: không gọi được Api ({Message})", ex.Message);
            return (SessionState.Unknown, null);
        }
    }

    /// <summary>Tối đa 1 KB — Api đã kiểm tra theo danh mục; Realtime chỉ chuyển tiếp cho client.</summary>
    public const int MaxLookLength = 1024;

    /// <summary>Lấy <c>avatar</c> (object) từ body /api/auth/me dưới dạng JSON gọn; thiếu / null / lỗi / quá dài → null.</summary>
    public static string? LookFromMe(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("avatar", out var a) || a.ValueKind != JsonValueKind.Object) return null;
            var raw = a.GetRawText();
            return raw.Length <= MaxLookLength ? raw : null;
        }
        catch (JsonException) { return null; }
    }
}
