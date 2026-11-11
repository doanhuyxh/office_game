using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Hubs;

/// <summary>
/// Bot trong văn phòng 3D: OfficeHub.Mcp báo "tài khoản bot vừa gọi tool" (khoá chung <c>Chat__InternalKey</c>) → hiện / cập nhật bot;
/// <see cref="BotSweeper"/> xoá bot quá 5 phút không hoạt động. Người thật của tài khoản đó đang ở trong văn phòng → không tạo avatar
/// thứ hai, chỉ gắn dòng trạng thái lên avatar đang có.
/// </summary>
public static class BotEndpoints
{
    public static void MapBots(this IEndpointRouteBuilder app)
    {
        app.MapPost(BotActivityRoute.Path, ReportAsync);
        app.MapPost(ChatRelayRoute.Path, RelayChatAsync);
    }

    /// <summary>Tin bot gửi qua Api (MCP) → phát như tin gửi qua hub. Chỉ nhận tin bot (ByBot) để khoá nội bộ không thành đường giả mạo tin người thật.</summary>
    private static async Task<IResult> RelayChatAsync(Chat.SendResultDto body, HttpRequest http, IOptions<ChatSettings> settings, Chat.ChatFanout fanout)
    {
        if (!BotActivityRoute.KeyMatches(http.Headers[BotActivityRoute.KeyHeader].ToString(), settings.Value.InternalKey))
            return Results.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        if (body?.Message is not { } m || m.Id == Guid.Empty || m.SenderId == Guid.Empty || !m.ByBot)
            return Results.Problem("Chỉ chuyển tiếp tin của bot", statusCode: StatusCodes.Status400BadRequest);
        await fanout.PublishMessageAsync(body);
        return Results.NoContent();
    }

    private static async Task<IResult> ReportAsync(BotActivity body, HttpRequest http, IOptions<ChatSettings> settings, BotPresence bots,
        Presence presence, OfficeMap map, IHubContext<OfficeRoomHub, IOfficeClient> hub, TimeProvider clock)
    {
        if (!BotActivityRoute.KeyMatches(http.Headers[BotActivityRoute.KeyHeader].ToString(), settings.Value.InternalKey))
            return Results.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        if (body.UserId == Guid.Empty || string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Activity))
            return Results.Problem("Thiếu userId / name / activity", statusCode: StatusCodes.Status400BadRequest);

        var (bot, placed) = bots.Record(body, clock.GetUtcNow());
        var group = hub.Clients.Group(OfficeRoomHub.OfficeGroup);
        if (!presence.TryGet(bot.UserId, out _) && placed)
        {
            // Đổi bàn: gỡ avatar cũ rồi đặt lại (tránh avatar "đi bộ" xuyên tường tới bàn mới)
            await group.PlayerLeft(bot.UserId);
            await group.PlayerJoined(OfficeRoomHub.ToDto(bot, map));
        }
        await group.BotStatus(bot.UserId, bot.Activity);
        return Results.NoContent();
    }
}

/// <summary>Mỗi 15 giây: bot quá hạn → offline (người thật cùng tài khoản đang trong văn phòng → chỉ gỡ dòng trạng thái).</summary>
public sealed class BotSweeper(BotPresence bots, Presence presence, IHubContext<OfficeRoomHub, IOfficeClient> hub, TimeProvider clock,
    ILogger<BotSweeper> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        while (await timer.WaitForNextTickAsync(ct))
        {
            try
            {
                foreach (var b in bots.Expire(clock.GetUtcNow()))
                {
                    var group = hub.Clients.Group(OfficeRoomHub.OfficeGroup);
                    if (presence.TryGet(b.UserId, out _)) await group.BotStatus(b.UserId, null);
                    else await group.PlayerLeft(b.UserId);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Lỗi quét bot offline");
            }
        }
    }
}
