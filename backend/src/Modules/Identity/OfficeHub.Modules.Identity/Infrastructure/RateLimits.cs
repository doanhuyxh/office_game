using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>
/// Giới hạn tần suất: đăng nhập / quên mật khẩu theo IP (chống dò mật khẩu, spam email), endpoint OAuth công khai theo IP,
/// và MỌI request bằng token AI theo từng token (<c>AccessTokens__RequestsPerMinute</c>).
/// </summary>
public static class RateLimits
{
    public const string Auth = "auth";
    /// <summary>/api/oauth/register, /token, /revoke: ẩn danh theo chuẩn → giới hạn theo IP.</summary>
    public const string OAuth = "oauth";
    /// <summary>Trần request / phút cho mỗi người dùng đăng nhập bằng cookie (trình duyệt).</summary>
    public const int CookieRequestsPerMinute = 600;

    public static IServiceCollection AddAuthRateLimits(this IServiceCollection services)
    {
        services.AddOptions<RateLimiterOptions>().Configure<IOptionsMonitor<AccessTokenSettings>>((o, tokens) =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Khoá theo IP + endpoint: cả văn phòng dùng chung 1 IP public (NAT) nên hạn mức phải đủ cho ~12 người
            // đăng nhập cùng lúc, và quên mật khẩu không ăn vào hạn mức đăng nhập.
            o.AddPolicy(Auth, ctx => RateLimitPartition.GetFixedWindowLimiter(
                $"{ctx.Connection.RemoteIpAddress}|{ctx.Request.Path}",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
            o.AddPolicy(OAuth, ctx => RateLimitPartition.GetFixedWindowLimiter(
                $"{ctx.Connection.RemoteIpAddress}|{ctx.Request.Path}",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));

            // UseRateLimiter chạy sau UseAuthentication → ctx.User đã có claim token / cookie.
            // Token AI: theo từng token (AccessTokens__RequestsPerMinute). Cookie: trần chung theo người dùng (TEST-20 — chặn script
            // dùng phiên bị chiếm để vét link tài liệu / vé tải lên); đủ rộng cho người thật mở nhiều tab. Ẩn danh: policy riêng từng endpoint.
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                ctx.User.IsAccessToken() && ctx.User.FindFirstValue(AccessTokenAuth.TokenIdClaim) is { } tokenId
                    ? RateLimitPartition.GetFixedWindowLimiter("tok:" + tokenId, _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = tokens.CurrentValue.RequestsPerMinute,
                        Window = TimeSpan.FromMinutes(1),
                    })
                    : ctx.User.GetUserId() is { } userId
                        ? RateLimitPartition.GetFixedWindowLimiter("usr:" + userId, _ => new FixedWindowRateLimiterOptions
                        {
                            PermitLimit = CookieRequestsPerMinute,
                            Window = TimeSpan.FromMinutes(1),
                        })
                        : RateLimitPartition.GetNoLimiter("none"));
        });
        services.AddRateLimiter(_ => { });
        return services;
    }
}
