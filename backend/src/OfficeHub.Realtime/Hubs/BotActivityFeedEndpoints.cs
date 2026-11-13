using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Hubs;

/// <summary>
/// Luồng "agent đang làm gì" (TEST-92): bên gửi (Mcp) đẩy sự kiện có cấu trúc của một bot vào <see cref="BotActivityFeed"/> (RAM).
/// Khoá nội bộ như <see cref="BotScreenRoute"/>; hub xem trực tiếp làm ở việc sau.
/// </summary>
public static class BotActivityFeedEndpoints
{
    public static void MapBotActivityFeed(this IEndpointRouteBuilder app) =>
        app.MapPost(BotActivityFeedRoute.Path, (BotActivityBatch? body, HttpRequest http, IOptions<ChatSettings> settings, BotActivityFeed feed, TimeProvider clock) =>
            Receive(body, http.Headers[BotActivityRoute.KeyHeader].ToString(), settings.Value.McpRealtimeKey, feed, clock.GetUtcNow()));

    /// <summary>
    /// Sai khoá → 401; thiếu userId / không có sự kiện / quá <see cref="BotActivityFeedRoute.MaxEvents"/> sự kiện / <c>kind</c> lạ / thiếu id → 400
    /// (cả lô không ghi gì). Trường quá dài → cắt. Trả <c>{ accepted, lastSeq }</c>.
    /// </summary>
    public static IResult Receive(BotActivityBatch? body, string? key, string? expectedKey, BotActivityFeed feed, DateTimeOffset now)
    {
        if (!BotActivityRoute.KeyMatches(key, expectedKey)) return Problem("Khoá nội bộ không đúng", StatusCodes.Status401Unauthorized);
        if (body is null || body.UserId == Guid.Empty) return Problem("Thiếu userId", StatusCodes.Status400BadRequest);
        if (body.Events is not { Count: > 0 } events) return Problem("Thiếu events", StatusCodes.Status400BadRequest);
        if (events.Count > BotActivityFeedRoute.MaxEvents)
            return Problem($"Tối đa {BotActivityFeedRoute.MaxEvents} sự kiện / lần — chia nhỏ lô", StatusCodes.Status400BadRequest);
        var clean = new List<BotActivityEvent>(events.Count);
        for (var i = 0; i < events.Count; i++)
        {
            if (BotActivityFeed.Clean(events[i], out var err) is not { } e) return Problem($"events[{i}]: {err}", StatusCodes.Status400BadRequest);
            clean.Add(e);
        }
        var saved = feed.Append(body.UserId.ToString(), clean, now);
        return Results.Ok(new { accepted = saved.Count, lastSeq = saved.Max(e => e.Seq) });
    }

    private static IResult Problem(string msg, int status) => Results.Problem(msg, statusCode: status);
}
