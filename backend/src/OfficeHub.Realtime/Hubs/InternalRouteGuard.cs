using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Realtime.Hubs;

/// <summary>
/// Đường nội bộ <c>/rt/internal/*</c> (Mcp → Realtime, khoá <c>Chat__McpToRealtimeKey</c> / <c>Chat__InternalKey</c>): kiểm khoá và đặt giới hạn kích thước body NGAY ở middleware
/// — minimal API đọc + giải mã toàn bộ body JSON trước khi vào handler, nên kiểm khoá trong handler để kẻ không có khoá vẫn bắt server đọc
/// body tuỳ ý (TEST-18). nginx cũng chặn đường này từ ngoài (frontend/nginx.conf).
/// </summary>
public static class InternalRouteGuard
{
    public const string Prefix = "/rt/internal";
    /// <summary>Ảnh màn hình bot ≤ 2 MB → base64 ≈ 2,7 MB + JSON.</summary>
    public const long ScreenMaxBody = 4 * 1024 * 1024;
    /// <summary>Luồng hoạt động bot: ≤ 50 sự kiện, mỗi sự kiện có thể có diff 16 000 + output / text 4 000 ký tự (TEST-92).</summary>
    public const long ActivityFeedMaxBody = 2 * 1024 * 1024;
    public const long DefaultMaxBody = 64 * 1024;

    public static long MaxBodyFor(string path) =>
        string.Equals(path, BotScreenRoute.Path, StringComparison.OrdinalIgnoreCase) ? ScreenMaxBody
        : string.Equals(path, BotActivityFeedRoute.Path, StringComparison.OrdinalIgnoreCase) ? ActivityFeedMaxBody
        : DefaultMaxBody;

    public static IApplicationBuilder UseInternalRouteGuard(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        if (ctx.Request.Path.StartsWithSegments(Prefix))
        {
            var key = ctx.RequestServices.GetRequiredService<IOptions<ChatSettings>>().Value.McpRealtimeKey;
            if (!BotActivityRoute.KeyMatches(ctx.Request.Headers[BotActivityRoute.KeyHeader].ToString(), key))
            {
                await Results.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized).ExecuteAsync(ctx);
                return;
            }
            var max = MaxBodyFor(ctx.Request.Path.Value ?? "");
            if (ctx.Request.ContentLength > max)
            {
                await Results.Problem("Yêu cầu quá lớn", statusCode: StatusCodes.Status413PayloadTooLarge).ExecuteAsync(ctx);
                return;
            }
            if (ctx.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } f) f.MaxRequestBodySize = max;
        }
        await next(ctx);
    });
}
