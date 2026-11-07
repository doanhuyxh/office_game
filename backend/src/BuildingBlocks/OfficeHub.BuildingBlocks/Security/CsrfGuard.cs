using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace OfficeHub.BuildingBlocks.Security;

/// <summary>
/// Chống CSRF / Cross-Site WebSocket Hijacking cho phiên cookie: request ghi (POST / PUT / PATCH / DELETE) và bắt tay WebSocket
/// phải đến từ chính trang OfficeHub. Bổ sung cho <c>SameSite=Lax</c> (Lax vẫn gửi cookie khi trang tấn công nằm cùng site,
/// vd. một subdomain khác của cùng tên miền, và form multipart không cần preflight).
/// Thứ tự kiểm tra: <c>Sec-Fetch-Site</c> (trình duyệt hiện đại luôn gửi) → <c>Origin</c> → <c>Referer</c>; không có header nào
/// (curl, script, máy chủ) → cho qua vì CSRF cần trình duyệt, mà trình duyệt luôn gửi ít nhất một trong các header trên với request ghi.
/// Bỏ qua: request mang <c>Authorization</c> (token AI — trình duyệt không tự gắn) và endpoint có CORS riêng (OAuth công khai).
/// </summary>
public static class CsrfGuard
{
    public enum Verdict { Allow, Block }

    /// <summary>Quyết định thuần (không phụ thuộc HttpContext) để test được.</summary>
    /// <param name="allowedOrigins">Origin hợp lệ dạng <c>scheme://host[:port]</c>, so sánh không phân biệt hoa thường.</param>
    public static Verdict Decide(string? secFetchSite, string? origin, string? referer, IReadOnlyCollection<string> allowedOrigins)
    {
        if (!string.IsNullOrWhiteSpace(secFetchSite))
            // same-origin: chính trang; none: người dùng tự mở (gõ địa chỉ / bookmark) — không phải trang khác kích hoạt.
            return secFetchSite.Trim().ToLowerInvariant() is "same-origin" or "none" ? Verdict.Allow : Verdict.Block;
        if (!string.IsNullOrWhiteSpace(origin))
            return IsAllowed(origin.Trim(), allowedOrigins) ? Verdict.Allow : Verdict.Block; // "null" (iframe sandbox, file://) → chặn
        if (!string.IsNullOrWhiteSpace(referer))
            return Uri.TryCreate(referer.Trim(), UriKind.Absolute, out var r) && IsAllowed(r.GetLeftPart(UriPartial.Authority), allowedOrigins)
                ? Verdict.Allow : Verdict.Block;
        return Verdict.Allow;
    }

    private static bool IsAllowed(string origin, IReadOnlyCollection<string> allowed) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var u) && allowed.Contains(u.GetLeftPart(UriPartial.Authority), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Gắn middleware. Đặt SAU <c>UseCors</c> / routing (cần metadata endpoint) và TRƯỚC <c>UseAuthentication</c>.
    /// Origin hợp lệ: <c>App__BaseUrl</c> + chính scheme/host của request (sau forwarded headers).
    /// </summary>
    public static IApplicationBuilder UseCsrfGuard(this IApplicationBuilder app)
    {
        var cfg = app.ApplicationServices.GetService(typeof(IConfiguration)) as IConfiguration;
        var baseOrigin = Uri.TryCreate(cfg?["App:BaseUrl"], UriKind.Absolute, out var b) ? b.GetLeftPart(UriPartial.Authority) : null;
        var logger = (app.ApplicationServices.GetService(typeof(ILoggerFactory)) as ILoggerFactory)?.CreateLogger(typeof(CsrfGuard).FullName!);

        return app.Use(async (ctx, next) =>
        {
            var req = ctx.Request;
            var unsafeMethod = !(HttpMethods.IsGet(req.Method) || HttpMethods.IsHead(req.Method) || HttpMethods.IsOptions(req.Method) || HttpMethods.IsTrace(req.Method));
            if ((unsafeMethod || ctx.WebSockets.IsWebSocketRequest)
                && !req.Headers.ContainsKey("Authorization")
                && ctx.GetEndpoint()?.Metadata.GetMetadata<ICorsMetadata>() is null)
            {
                var allowed = new List<string>(2) { $"{req.Scheme}://{req.Host}" };
                if (baseOrigin is not null) allowed.Add(baseOrigin);
                var verdict = Decide(req.Headers["Sec-Fetch-Site"], req.Headers.Origin, req.Headers.Referer, allowed);
                if (verdict == Verdict.Block)
                {
                    logger?.LogWarning("Chặn request khác nguồn {Method} {Path} (Sec-Fetch-Site={Site}, Origin={Origin})",
                        req.Method, req.Path, req.Headers["Sec-Fetch-Site"].ToString(), req.Headers.Origin.ToString());
                    ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                    await Results.Problem(statusCode: 403, title: "csrf", detail: "Yêu cầu bị chặn vì không đến từ trang OfficeHub").ExecuteAsync(ctx);
                    return;
                }
            }
            await next();
        });
    }
}
