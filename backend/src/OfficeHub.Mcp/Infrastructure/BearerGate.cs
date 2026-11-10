using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// Cổng vào /mcp: bắt buộc <c>Authorization: Bearer ohk_…</c> và token còn hiệu lực (hỏi Api <c>GET /api/auth/me</c>,
/// nhớ kết quả vài chục giây). Sai → 401 + <c>WWW-Authenticate: Bearer</c> để client AI báo lỗi kết nối ngay,
/// thay vì kết nối được rồi tool nào cũng lỗi. Token vẫn được Api kiểm tra lại ở MỌI lệnh gọi.
/// </summary>
public sealed class BearerGate(RequestDelegate next, IHttpClientFactory http, IMemoryCache cache, IOptions<McpSettings> options,
    IOptions<AppSettings> app, ILogger<BearerGate> log)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        if (!AccessTokenAuth.HasBearerToken(header))
        {
            await Reject(ctx, "Chưa đăng nhập. Kết nối bằng OAuth hoặc gửi token tạo ở trang Kết nối AI qua header Authorization: Bearer <token>.");
            return;
        }

        var key = "tok:" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(header)));
        if (!cache.TryGetValue(key, out bool valid))
        {
            if (await CheckAsync(header, ctx.Connection.RemoteIpAddress?.ToString(), ctx.RequestAborted) is not { } checkedValid)
            {
                ctx.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                await ctx.Response.WriteAsJsonAsync(new { status = 503, detail = "Máy chủ OfficeHub đang không phản hồi, thử lại sau." },
                    options: null, contentType: "application/problem+json");
                return;
            }
            valid = checkedValid;
            cache.Set(key, valid, TimeSpan.FromSeconds(Math.Max(1, options.Value.TokenCacheSeconds)));
        }
        if (!valid)
        {
            await Reject(ctx, "Token không hợp lệ, đã hết hạn hoặc đã bị thu hồi.");
            return;
        }
        await next(ctx);
    }

    /// <summary>true / false = Api trả lời; null = Api không phản hồi (không nhớ kết quả).</summary>
    private async Task<bool?> CheckAsync(string header, string? clientIp, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, "/api/auth/me");
        req.Headers.TryAddWithoutValidation("Authorization", header);
        // IP client AI → nhật ký AI của Api ghi đúng IP (không phải IP nội bộ của Mcp)
        if (clientIp is not null) req.Headers.TryAddWithoutValidation("X-Forwarded-For", clientIp);
        try
        {
            using var res = await http.CreateClient(OfficeHubApi.HttpClientName).SendAsync(req, ct);
            if (res.IsSuccessStatusCode) return true;
            if ((int)res.StatusCode is 401 or 403) return false;
            log.LogWarning("Kiểm tra token MCP: Api trả {Status}", (int)res.StatusCode);
            return null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            log.LogWarning("Kiểm tra token MCP: không gọi được Api ({Message})", e.Message);
            return null;
        }
    }

    /// <summary>
    /// 401 + <c>WWW-Authenticate: Bearer resource_metadata="…"</c> (RFC 9728): client hỗ trợ OAuth (claude.ai, Cursor, Codex…)
    /// đọc metadata → tự đăng ký + mở trang đăng nhập OfficeHub; client dùng token cá nhân chỉ thấy lỗi thiếu token.
    /// </summary>
    private Task Reject(HttpContext ctx, string detail)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        ctx.Response.Headers.WWWAuthenticate =
            $"Bearer resource_metadata=\"{OAuthMetadata.ResourceMetadataUrl(app.Value.BaseUrl)}\", scope=\"{OAuthMetadata.Scope}\"";
        return ctx.Response.WriteAsJsonAsync(new { status = 401, detail }, options: null, contentType: "application/problem+json");
    }
}
