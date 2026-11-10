using System.Collections.Concurrent;
using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Realtime.Simulation;

/// <summary>Bot (tài khoản HR đánh dấu) đang làm việc qua MCP — chỉ để hiển thị, ngồi yên ở một bàn, không đi lại / voice / chat.</summary>
public sealed class Bot
{
    public required string UserId { get; init; }
    public string Name = "";
    public string? Look;
    public string? Zone;
    public Seat? Seat;
    public string Activity = "";
    public DateTimeOffset LastAt;
}

/// <summary>
/// Bot "online" = gọi tool MCP trong <see cref="BotActivityRoute.OnlineMinutes"/> phút gần nhất (OfficeHub.Mcp báo qua
/// <c>POST /rt/internal/bot-activity</c>). Chỉ trong RAM như <see cref="Presence"/>. Bot ngồi ở bàn trống trong khu phòng ban
/// (<c>seats[].zone</c> = <c>departments.MapZone</c>); chưa gán khu / hết bàn → khu làm việc chung (<see cref="SharedZone"/>), rồi bàn bất kỳ.
/// Cùng một người luôn thử cùng một bàn trước (theo băm userId) để bot không nhảy chỗ mỗi lần online lại.
/// </summary>
public sealed class BotPresence(OfficeMap map, Presence presence)
{
    public const string SharedZone = "work";
    public static readonly TimeSpan Timeout = TimeSpan.FromMinutes(BotActivityRoute.OnlineMinutes);
    private readonly ConcurrentDictionary<string, Bot> _bots = new();
    private readonly Lock _seatLock = new();

    public IEnumerable<Bot> All => _bots.Values;

    public bool TryGet(string userId, out Bot bot) => _bots.TryGetValue(userId, out bot!);

    /// <summary>Ghi nhận hoạt động; trả về bot + true nếu bot vừa online (hoặc vừa đổi bàn vì đổi khu).</summary>
    public (Bot Bot, bool Placed) Record(BotActivity a, DateTimeOffset now)
    {
        var id = a.UserId.ToString();
        lock (_seatLock)
        {
            var isNew = !_bots.TryGetValue(id, out var bot);
            bot ??= new Bot { UserId = id };
            bot.Name = a.Name.Length > 100 ? a.Name[..100] : a.Name;
            bot.Look = a.Look;
            bot.Activity = a.Activity.Length > 120 ? a.Activity[..120] : a.Activity;
            bot.LastAt = now;
            var placed = isNew || bot.Zone != a.Zone || bot.Seat is null;
            if (placed)
            {
                bot.Zone = a.Zone;
                bot.Seat = PickSeat(id, a.Zone);
            }
            _bots[id] = bot;
            return (bot, placed);
        }
    }

    /// <summary>Bot không hoạt động quá <see cref="Timeout"/> → xoá, trả danh sách đã xoá.</summary>
    public List<Bot> Expire(DateTimeOffset now)
    {
        var gone = new List<Bot>();
        foreach (var b in _bots.Values)
            if (now - b.LastAt > Timeout && _bots.TryRemove(new(b.UserId, b))) gone.Add(b);
        return gone;
    }

    private Seat? PickSeat(string userId, string? zone)
    {
        var taken = _bots.Values.Where(b => b.UserId != userId && b.Seat is not null).Select(b => b.Seat!.Id).ToHashSet();
        foreach (var p in presence.All)
            if (p.Anim == 2 && map.Seats.FirstOrDefault(s => Math.Abs(s.X - p.X) < 0.15 && Math.Abs(s.Z - p.Z) < 0.15) is { } occupied)
                taken.Add(occupied.Id);
        var hash = StableHash(userId);
        foreach (var candidates in new[]
                 {
                     zone is null ? [] : map.Seats.Where(s => s.Zone == zone).ToArray(),
                     map.Seats.Where(s => s.Zone == SharedZone).ToArray(),
                     map.Seats,
                 })
        {
            if (candidates.Length == 0) continue;
            for (var i = 0; i < candidates.Length; i++)
            {
                var s = candidates[(int)((hash + (uint)i) % (uint)candidates.Length)];
                if (!taken.Contains(s.Id)) return s;
            }
        }
        return null;
    }

    /// <summary>FNV-1a — string.GetHashCode đổi mỗi lần chạy, cần ổn định để bot giữ bàn sau khi Realtime khởi động lại.</summary>
    private static uint StableHash(string s)
    {
        var h = 2166136261u;
        foreach (var c in s) h = (h ^ c) * 16777619u;
        return h;
    }

    /// <summary>Góc quay khi ngồi theo hướng bàn — khớp FACING_ANGLE ở FE (engine/officeMap.ts).</summary>
    public static float FacingAngle(string facing) => facing switch
    {
        "n" => MathF.PI,
        "e" => MathF.PI / 2,
        "w" => -MathF.PI / 2,
        _ => 0f,
    };
}
