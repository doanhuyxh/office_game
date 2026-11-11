using System.Collections.Concurrent;
using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Realtime.Simulation;

/// <summary>Bot (tài khoản HR đánh dấu) đang làm việc qua MCP — hiện trong 3D, đi bộ tới chỗ được gọi (<c>go_to</c>), không voice.</summary>
public sealed class Bot
{
    public required string UserId { get; init; }
    public string Name = "";
    public string? Look;
    public string? Zone;
    public string Activity = "";
    public DateTimeOffset LastAt;
    public float X, Z, R;
    /// <summary>0 đứng, 1 đi, 2 ngồi — như <see cref="Player.Anim"/>.</summary>
    public byte Anim;
    /// <summary>Đích hiện tại (đang đi tới hoặc đã tới); null = chưa có (chưa đặt chỗ).</summary>
    public BotSpot? Spot;
    /// <summary>Gọi go_to rồi → ở lại chỗ đó (kể cả đổi khu phòng ban) cho tới lần go_to kế (chủ dự án chốt 2026-11-11).</summary>
    public bool Explicit;
    public readonly Queue<(double X, double Z)> Path = new();
    public bool Dirty;
}

/// <summary>
/// Bot "online" = gọi tool MCP trong <see cref="BotActivityRoute.OnlineMinutes"/> phút gần nhất (OfficeHub.Mcp báo qua
/// <c>POST /rt/internal/bot-activity</c>). Chỉ trong RAM như <see cref="Presence"/>.
/// Chỗ mặc định: bàn trống trong khu phòng ban (<c>seats[].zone</c> = <c>departments.MapZone</c>) → khu làm việc chung → bàn bất kỳ
/// (thử cùng một bàn trước theo băm userId). Tool <c>go_to</c> → đi bộ (A* trên <see cref="NavGrid"/>, 4,2 m/s như người) tới phòng / khu /
/// bàn / cạnh một người và ở lại đó; chỗ đã chọn được nhớ cả khi bot offline rồi online lại (mất khi Realtime khởi động lại).
/// </summary>
public sealed class BotPresence(OfficeMap map, Presence presence)
{
    public const string SharedZone = "work";
    public const double Speed = 4.2;
    public static readonly TimeSpan Timeout = TimeSpan.FromMinutes(BotActivityRoute.OnlineMinutes);
    private readonly ConcurrentDictionary<string, Bot> _bots = new();
    /// <summary>Chỗ đã go_to của từng bot (giữ khi bot offline).</summary>
    private readonly ConcurrentDictionary<string, BotSpot> _remembered = new();
    private readonly ChairSpot[] _chairs = OfficePlaces.Chairs(map);
    private readonly Lock _lock = new();

    public IEnumerable<Bot> All => _bots.Values;

    public bool TryGet(string userId, out Bot bot) => _bots.TryGetValue(userId, out bot!);

    /// <summary>Ghi nhận hoạt động; trả về bot + true nếu bot vừa online (hoặc vừa đổi bàn vì đổi khu).</summary>
    public (Bot Bot, bool Placed) Record(BotActivity a, DateTimeOffset now)
    {
        var id = a.UserId.ToString();
        lock (_lock)
        {
            var isNew = !_bots.TryGetValue(id, out var bot);
            bot ??= new Bot { UserId = id };
            bot.Name = a.Name.Length > 100 ? a.Name[..100] : a.Name;
            bot.Look = a.Look;
            bot.Activity = a.Activity.Length > 120 ? a.Activity[..120] : a.Activity;
            bot.LastAt = now;
            var placed = false;
            if (isNew && _remembered.TryGetValue(id, out var keep) && !Taken(id, keep.SpotKey))
            {
                (bot.Zone, bot.Explicit) = (a.Zone, true);
                Place(bot, keep);
                placed = true;
            }
            else if (isNew || (!bot.Explicit && (bot.Zone != a.Zone || bot.Spot is null)))
            {
                bot.Zone = a.Zone;
                Place(bot, DeskSpot(id, a.Zone));
                placed = true;
            }
            _bots[id] = bot;
            return (bot, placed);
        }
    }

    /// <summary>Đặt bot ngay tại chỗ (lúc vừa online — không đi bộ).</summary>
    private static void Place(Bot bot, BotSpot spot)
    {
        bot.Path.Clear();
        bot.Spot = spot;
        (bot.X, bot.Z, bot.R, bot.Anim) = ((float)spot.X, (float)spot.Z, spot.Angle, spot.Sit ? (byte)2 : (byte)0);
        bot.Dirty = true;
    }

    /// <summary>
    /// Bot đi bộ tới <paramref name="place"/>. Trả lỗi tiếng Việt (null = đã bắt đầu đi / đã ở đó). <paramref name="distance"/> = độ dài đường đi (m).
    /// </summary>
    public string? GoTo(string userId, OfficePlace place, out double distance)
    {
        distance = 0;
        lock (_lock)
        {
            if (!_bots.TryGetValue(userId, out var bot)) return "Bot chưa có mặt trong văn phòng";
            var spot = SpotFor(bot, place);
            if (spot is null) return $"Không còn chỗ trống ở {place.Name}";
            var path = map.Nav.FindPath(bot.X, bot.Z, spot.X, spot.Z);
            if (path.Count == 0 && Math.Abs(bot.X - spot.X) + Math.Abs(bot.Z - spot.Z) > 0.3) return $"Không có đường tới {place.Name}";
            bot.Path.Clear();
            foreach (var p in path) bot.Path.Enqueue(p);
            // Ngồi bàn / ghế: điểm cuối đường đi là ô trống cạnh ghế → bước nốt vào đúng chỗ ngồi
            if (spot.Sit && (path.Count == 0 || Math.Abs(path[^1].X - spot.X) + Math.Abs(path[^1].Z - spot.Z) > 0.01)) bot.Path.Enqueue((spot.X, spot.Z));
            double px = bot.X, pz = bot.Z;
            foreach (var p in bot.Path) { distance += Math.Sqrt((p.X - px) * (p.X - px) + (p.Z - pz) * (p.Z - pz)); (px, pz) = (p.X, p.Z); }
            bot.Spot = spot;
            bot.Explicit = true;
            _remembered[userId] = spot;
            bot.Anim = bot.Path.Count > 0 ? (byte)1 : (spot.Sit ? (byte)2 : (byte)0);
            bot.Dirty = true;
            return null;
        }
    }

    /// <summary>
    /// Bước mô phỏng (gọi từ <see cref="OfficeLoop"/> 10 Hz): bot đang đi tiến <see cref="Speed"/> × dt theo đường; tới nơi → ngồi / đứng quay đúng hướng.
    /// Trả các bot vừa tới nơi (để báo Api cấp quyền kênh chat phòng).
    /// </summary>
    public List<Bot> Step(double dt)
    {
        var arrived = new List<Bot>();
        lock (_lock)
        {
            foreach (var b in _bots.Values)
            {
                if (b.Path.Count == 0) continue;
                var budget = Speed * dt;
                while (budget > 0 && b.Path.TryPeek(out var t))
                {
                    double dx = t.X - b.X, dz = t.Z - b.Z, dist = Math.Sqrt(dx * dx + dz * dz);
                    if (dist > 1e-4) b.R = (float)Math.Atan2(dx, dz);
                    if (dist <= budget) { (b.X, b.Z) = ((float)t.X, (float)t.Z); b.Path.Dequeue(); budget -= dist; }
                    else { b.X += (float)(dx / dist * budget); b.Z += (float)(dz / dist * budget); budget = 0; }
                }
                if (b.Path.Count == 0 && b.Spot is { } s)
                {
                    (b.X, b.Z, b.R, b.Anim) = ((float)s.X, (float)s.Z, s.Angle, s.Sit ? (byte)2 : (byte)0);
                    arrived.Add(b);
                }
                else b.Anim = 1;
                b.Dirty = true;
            }
        }
        return arrived;
    }

    /// <summary>Bot không hoạt động quá <see cref="Timeout"/> → xoá, trả danh sách đã xoá (chỗ đã go_to vẫn được nhớ).</summary>
    public List<Bot> Expire(DateTimeOffset now)
    {
        var gone = new List<Bot>();
        foreach (var b in _bots.Values)
            if (now - b.LastAt > Timeout && _bots.TryRemove(new(b.UserId, b))) gone.Add(b);
        return gone;
    }

    private BotSpot? SpotFor(Bot bot, OfficePlace place)
    {
        switch (place.Kind)
        {
            case "desk":
                return DeskSpot(bot.UserId, bot.Zone);
            case "zone":
                if (PickSeat(bot.UserId, [map.Seats.Where(s => s.Zone == place.Id).ToArray()]) is { } zs) return SeatSpot(zs, place.Name);
                return map.Areas.FirstOrDefault(a => a.Id == place.Id) is { } area ? StandNear((area.X0 + area.X1) / 2, (area.Z0 + area.Z1) / 2, place.Name, null) : null;
            case "room":
                if (map.Rooms.FirstOrDefault(r => r.Id == place.Id) is not { } room) return null;
                var roomId = room.Walls ? room.Id : null;
                var hash = StableHash(bot.UserId);
                var chairs = _chairs.Where(c => room.Contains(c.X, c.Z) && !Taken(bot.UserId, c.Id)).ToArray();
                if (chairs.Length > 0)
                {
                    var c = chairs[(int)(hash % (uint)chairs.Length)];
                    return new BotSpot(c.X, c.Z, c.Angle, true, c.Id, room.Name, roomId);
                }
                if (PickSeat(bot.UserId, [map.Seats.Where(s => room.Contains(s.X, s.Z)).ToArray()]) is { } rs) return SeatSpot(rs, room.Name) with { RoomId = roomId };
                return StandNear((room.X0 + room.X1) / 2, (room.Z0 + room.Z1) / 2, room.Name, roomId);
            case "person":
                if (!presence.TryGet(place.Id, out var p)) return null;
                float px, pz;
                lock (p) { (px, pz) = (p.X, p.Z); }
                // Đứng cách người đó ~1 m (phía bot đang ở), quay mặt về họ
                double dx = bot.X - px, dz = bot.Z - pz, len = Math.Max(0.01, Math.Sqrt(dx * dx + dz * dz));
                var near = StandNear(px + dx / len, pz + dz / len, $"cạnh {place.Name}", map.Rooms.FirstOrDefault(r => r.Walls && r.Contains(px, pz))?.Id);
                return near is null ? null : near with { Angle = (float)Math.Atan2(px - near.X, pz - near.Z) };
            default:
                return null;
        }
    }

    private BotSpot? StandNear(double x, double z, string name, string? roomId)
    {
        if (map.Nav.NearestFree(x, z) is not { } cell) return null;
        var c = map.Nav.Center(cell.I, cell.J);
        return new BotSpot(c.X, c.Z, 0, false, null, name, roomId);
    }

    private BotSpot DeskSpot(string userId, string? zone) =>
        PickSeat(userId,
        [
            zone is null ? [] : map.Seats.Where(s => s.Zone == zone).ToArray(),
            map.Seats.Where(s => s.Zone == SharedZone).ToArray(),
            map.Seats,
        ]) is { } seat
            ? SeatSpot(seat, $"bàn {seat.Id}")
            : new BotSpot(map.Spawn.X, map.Spawn.Z, 0, false, null, "lối vào", null);

    private static BotSpot SeatSpot(Seat s, string name) => new(s.X, s.Z, FacingAngle(s.Facing), true, s.Id, name, null);

    /// <summary>Chỗ ngồi đang có bot khác giữ, hoặc có người thật đang ngồi (anim 2 trong 0,15 m).</summary>
    private bool Taken(string userId, string? spotKey)
    {
        if (spotKey is null) return false;
        if (_bots.Values.Any(b => b.UserId != userId && b.Spot?.SpotKey == spotKey)) return true;
        var (x, z) = map.Seats.FirstOrDefault(s => s.Id == spotKey) is { } seat ? (seat.X, seat.Z)
            : _chairs.FirstOrDefault(c => c.Id == spotKey) is { } ch ? (ch.X, ch.Z) : (double.NaN, double.NaN);
        if (double.IsNaN(x)) return false;
        foreach (var p in presence.All)
        {
            float px, pz; byte anim;
            lock (p) { (px, pz, anim) = (p.X, p.Z, p.Anim); }
            if (anim == 2 && Math.Abs(px - x) < 0.15 && Math.Abs(pz - z) < 0.15) return true;
        }
        return false;
    }

    private Seat? PickSeat(string userId, Seat[][] tiers)
    {
        var hash = StableHash(userId);
        foreach (var candidates in tiers)
        {
            if (candidates.Length == 0) continue;
            for (var i = 0; i < candidates.Length; i++)
            {
                var s = candidates[(int)((hash + (uint)i) % (uint)candidates.Length)];
                if (!Taken(userId, s.Id)) return s;
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
