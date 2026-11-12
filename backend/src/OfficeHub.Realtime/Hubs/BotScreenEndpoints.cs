using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Screens;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Hubs;

/// <summary>
/// Bot chiếu lên TV phòng họp (2026-11-11): ảnh chụp màn hình cập nhật liên tục, trang Markdown (present_markdown, 2026-11-12) hoặc tài liệu trong kho. Chỉ khi bot đang NGỒI / ĐỨNG trong một
/// phòng có tường (đã go_to tới nơi); chỉ người đang ở trong phòng nhận <c>ScreenChanged</c> (như chiếu tài liệu của người).
/// Ảnh chỉ nằm trong RAM (khung mới nhất), phục vụ ở <c>/rt/screens/{phòng}/{mã ngẫu nhiên}</c>.
/// </summary>
public static class BotScreenEndpoints
{
    public static void MapBotScreens(this IEndpointRouteBuilder app)
    {
        app.MapPost(BotScreenRoute.Path, PresentAsync);
        app.MapGet(BotScreens.FramePathPrefix + "/{roomId}/{token}", FrameAsync);
    }

    /// <summary>
    /// Ảnh khung mới nhất. Chỉ người đã đăng nhập (cookie) ĐANG ĐỨNG trong phòng đó (TEST-18: trước đây ai có link cũng xem được, kể cả đã rời
    /// phòng / người ngoài). Chưa đăng nhập → 401; không ở trong phòng / mã sai / đã tắt → 404. Không cache (mỗi khung một <c>?v=</c>).
    /// </summary>
    private static IResult FrameAsync(string roomId, string token, HttpResponse res, System.Security.Claims.ClaimsPrincipal user, BotScreens bots,
        Presence presence, OfficeMap map)
    {
        if (user.Identity?.IsAuthenticated != true || user.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier) is not { } uid)
            return Results.Problem("Cần đăng nhập", statusCode: StatusCodes.Status401Unauthorized);
        if (!presence.TryGet(uid, out var viewer) || map.WallRoomOf(viewer)?.Id != roomId) return Results.NotFound();
        var p = bots.Get(roomId);
        if (p?.Frame is not { } f || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(p.Token), Encoding.ASCII.GetBytes(token ?? "")))
            return Results.NotFound();
        res.Headers.CacheControl = "no-store";
        res.Headers["X-Content-Type-Options"] = "nosniff";
        return Results.Bytes(f.Bytes, f.ContentType);
    }

    private static IResult Problem(string msg, int status) => Results.Problem(msg, statusCode: status);

    private static async Task<IResult> PresentAsync(BotScreenRequest body, HttpRequest http, IOptions<ChatSettings> settings, BotPresence bots, BotScreens shows,
        RoomScreens screens, Presence presence, OfficeMap map, IHubContext<OfficeRoomHub, IOfficeClient> hub, TimeProvider clock)
    {
        if (!BotActivityRoute.KeyMatches(http.Headers[BotActivityRoute.KeyHeader].ToString(), settings.Value.InternalKey))
            return Problem("Khoá nội bộ không đúng", 401);
        var a = body?.Activity;
        if (a is null || a.UserId == Guid.Empty || string.IsNullOrWhiteSpace(a.Name) || body!.Mode is not ("frame" or "markdown" or "document" or "stop"))
            return Problem("Yêu cầu chiếu không hợp lệ", 400);
        var uid = a.UserId.ToString();
        if (presence.TryGet(uid, out _)) return Problem("Tài khoản này đang được người thật dùng trong văn phòng 3D — chiếu từ trình duyệt", 409);
        if (!bots.TryGet(uid, out var bot) || bot.Spot?.RoomId is not { } roomId || bot.Path.Count > 0
            || map.Rooms.FirstOrDefault(r => r.Id == roomId && r.Walls) is not { } room)
            return Problem("Bot phải đang ở trong một phòng có tường (go_to phòng họp và đợi tới nơi) mới chiếu được", 409);
        var now = clock.GetUtcNow();
        bots.Record(a, now); // dòng trạng thái + giữ online
        var audience = presence.All.Where(o => map.WallRoomOf(o)?.Id == room.Id).Select(o => o.ConnectionId).ToList();
        var current = shows.Get(room.Id);

        if (body.Mode == "stop")
        {
            if (current?.UserId != uid) return Results.Ok(new { stopped = false });
            shows.End(room.Id, current);
            if (ReferenceEquals(screens.Get(room.Id), current.Screen) && screens.Clear(room.Id))
                await hub.Clients.Clients(audience).ScreenChanged(room.Id, null);
            return Results.Ok(new { stopped = true });
        }
        if (shows.RecentlyCleared(room.Id, now))
            return Problem("Người trong phòng vừa tắt màn hình — đợi 1 phút hoặc khi được nhờ chiếu lại", 409);

        ScreenDto screen;
        if (body.Mode == "frame")
        {
            // Kiểm ảnh trước (lỗi rõ ràng cho agent), rồi mới tới tần suất
            if (BotScreens.DecodeImage(body.Image, out var err) is not { } bytes) return Problem(err!, 400);
            var type = BotScreens.DetectImage(bytes)!;
            BotPresentation p;
            lock (shows) // kiểm tần suất + ghi LastAt nguyên tử: 2 lệnh song song không cùng lọt (TEST-18)
            {
                current = shows.Get(room.Id);
                if (current?.UserId == uid && current.Frame is not null && now - current.LastAt < BotScreens.MinInterval)
                    return Problem("Cập nhật màn hình tối đa 1 ảnh / 3 giây", 429);
                p = shows.Begin(uid, room.Id);
                p.Frame = new BotFrame(bytes, type, (p.Frame?.Version ?? 0) + 1, now);
                p.LastAt = now;
            }
            var title = string.IsNullOrWhiteSpace(body.Caption) ? $"Màn hình của {bot.Name}" : Cut(body.Caption.Trim(), 120);
            screen = new ScreenDto(room.Id, room.Name, $"bot:{uid}", title, type == "image/png" ? "screen.png" : type == "image/webp" ? "screen.webp" : "screen.jpg",
                type, "Image", BotScreens.FrameUrl(p), true, bot.Name, Instants.Format(now), Live: true);
            p.Screen = screen;
        }
        else if (body.Mode == "markdown")
        {
            if (BotScreens.CleanMarkdown(body.Markdown, out var err) is not { } md) return Problem(err!, 400);
            BotPresentation p;
            lock (shows)
            {
                current = shows.Get(room.Id);
                if (current?.UserId == uid && current.Screen?.Kind == "Markdown" && now - current.LastAt < BotScreens.MarkdownMinInterval)
                    return Problem("Cập nhật trình bày tối đa 1 lần / giây", 429);
                p = shows.Begin(uid, room.Id);
                p.LastAt = now;
            }
            var title = string.IsNullOrWhiteSpace(body.Caption) ? $"{bot.Name} đang trình bày" : Cut(body.Caption.Trim(), 120);
            screen = new ScreenDto(room.Id, room.Name, $"bot:{uid}", title, "", "text/markdown", "Markdown", "", true, bot.Name, Instants.Format(now),
                Live: true, Markdown: md);
            (p.Frame, p.LastAt, p.Screen) = (null, now, screen);
        }
        else
        {
            Guid assetId;
            try { using var d = JsonDocument.Parse(body.DetailJson ?? "{}"); assetId = d.RootElement.GetProperty("id").GetGuid(); }
            catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException)
            { return Problem("Không đọc được tài liệu", 400); }
            if (RoomScreens.Parse(body.DetailJson!, body.FileJson ?? "{}", room.Id, room.Name, assetId, bot.Name, Instants.Format(now)) is not { } doc)
                return Problem("Không đọc được tài liệu", 400);
            var p = shows.Begin(uid, room.Id);
            (p.Frame, p.LastAt, p.Screen) = (null, now, doc);
            screen = doc;
        }
        screens.Set(screen);
        await hub.Clients.Clients(audience).ScreenChanged(room.Id, screen);
        return Results.Ok(new { room = room.Name, viewers = audience.Count, live = screen.Live });
    }

    private static string Cut(string s, int max) => s.Length <= max ? s : s[..max] + "…";

    /// <summary>
    /// Gọi từ <see cref="BotSweeper"/>: tắt màn hình bot khi bot rời phòng / offline / 10 phút không cập nhật, hoặc khi màn hình đã bị người khác
    /// thay / tắt (chỉ dọn lượt chiếu của bot, không đụng màn hình người khác).
    /// </summary>
    internal static async Task SweepAsync(BotScreens shows, BotPresence bots, RoomScreens screens, Presence presence, OfficeMap map,
        IHubContext<OfficeRoomHub, IOfficeClient> hub, DateTimeOffset now)
    {
        foreach (var p in shows.All.ToList())
        {
            var mine = ReferenceEquals(screens.Get(p.RoomId), p.Screen);
            var stale = !bots.TryGet(p.UserId, out var b) || b.Spot?.RoomId != p.RoomId || b.Path.Count > 0 || now - p.LastAt > BotScreens.Idle;
            if (mine && !stale) continue;
            shows.End(p.RoomId, p);
            if (mine && screens.Clear(p.RoomId))
                await hub.Clients.Clients(presence.All.Where(o => map.WallRoomOf(o)?.Id == p.RoomId).Select(o => o.ConnectionId).ToList())
                    .ScreenChanged(p.RoomId, null);
        }
    }
}
