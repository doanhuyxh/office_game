using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;

namespace OfficeHub.Modules.Identity.Infrastructure;

/// <summary>Giới hạn tần suất cho đăng nhập / quên mật khẩu theo IP (chống dò mật khẩu, spam email).</summary>
public static class RateLimits
{
    public const string Auth = "auth";

    public static IServiceCollection AddAuthRateLimits(this IServiceCollection services) =>
        services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            // Khoá theo IP + endpoint: cả văn phòng dùng chung 1 IP public (NAT) nên hạn mức phải đủ cho ~12 người
            // đăng nhập cùng lúc, và quên mật khẩu không ăn vào hạn mức đăng nhập.
            o.AddPolicy(Auth, ctx => RateLimitPartition.GetFixedWindowLimiter(
                $"{ctx.Connection.RemoteIpAddress}|{ctx.Request.Path}",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(1) }));
        });
}
