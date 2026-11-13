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
    /// <summary>Đang làm (true) / rảnh (false) / chưa rõ (null) — <see cref="BotWork"/>.</summary>
    public bool? Busy;
    /// <summary>Việc đang làm ("WEB-12 · Tên việc"), null khi rảnh / không rõ.</summary>
    public string? Task;
    /// <summary>Lần cuối agent-runner báo trạng thái — trong <see cref="BotPresence.Timeout"/> thì bỏ qua trạng thái suy từ bảng việc.</summary>
    public DateTimeOffset RunnerAt;
    /// <summary>Rảnh từ lúc nào (null khi đang làm) — rảnh đủ <see cref="BotWork.IdleDelaySeconds"/> mới ra Khu nghỉ.</summary>
    public DateTimeOffset? IdleSince;
    /// <summary>Chỗ hiện tại là chỗ nghỉ (Khu nghỉ / Pantry).</summary>
    public bool AtRest;
    /// <summary>Phiên họp agent bot đang dự (đã cho đi vào phòng họp — TEST-76); trong phiên bot được giữ ở phòng họp.</summary>
    public BotMeeting? Meeting;
    /// <summary>Đang giữ lượt nói trong phiên họp → bong bóng <see cref="BotPresence.SpeakingBubble"/>.</summary>
    public bool Speaking;
    public readonly Queue<(double X, double Z)> Path = new();
    public bool Dirty;
}

public sealed record BotMeeting(Guid SessionId, string RoomId, string Topic);

/// <summary>
/// Bot "online" = gọi tool MCP trong <see cref="BotActivityRoute.OnlineMinutes"/> phút gần nhất (OfficeHub.Mcp báo qua
/// <c>POST /rt/internal/bot-activity</c>). Chỉ trong RAM như <see cref="Presence"/>.
/// Chỗ mặc định: bàn trống trong khu phòng ban (<c>seats[].zone</c> = <c>departments.MapZone</c>) → khu làm việc chung → bàn bất kỳ
/// (thử cùng một bàn trước theo băm userId). Tool <c>go_to</c> → đi bộ (A* trên <see cref="NavGrid"/>, 4,2 m/s như người) tới phòng / khu /
/// bàn / cạnh một người và ở lại đó; chỗ đã chọn được nhớ cả khi bot offline rồi online lại (mất khi Realtime khởi động lại).
/// Đang làm / rảnh (2026-11-13, <see cref="BotWork"/>): đang làm → bàn; rảnh đủ <see cref="BotWork.IdleDelaySeconds"/> giây → đi bộ ra Khu nghỉ
/// (hết chỗ → Pantry → đứng trong Khu nghỉ). Chỗ go_to giữ tới khi bot đổi giữa đang làm ↔ rảnh.
/// Họp agent (TEST-76, <see cref="SyncMeetings"/>): phiên đang họp → bot dự họp đi bộ vào phòng họp (chưa online cũng hiện, từ lối vào), ở đó
/// suốt phiên bất kể đang làm / rảnh; phiên kết thúc → về bàn / Khu nghỉ theo luật trên.
/// </summary>
public sealed class BotPresence(OfficeMap map, Presence presence)
{
    public const string SharedZone = "work";
    /// <summary>Chỗ nghỉ theo thứ tự ưu tiên (id phòng trong shared/office-map.json).</summary>
    public static readonly string[] RestRooms = ["lounge", "pantry"];
    public const double Speed = 4.2;
    public const string SpeakingBubble = "🎤 Đang phát biểu";
    public static readonly TimeSpan Timeout = TimeSpan.FromMinutes(BotActivityRoute.OnlineMinutes);
    private readonly ConcurrentDictionary<string, Bot> _bots = new();
    /// <summary>Chỗ đã go_to của từng bot (giữ khi bot offline).</summary>
    private readonly ConcurrentDictionary<string, BotSpot> _remembered = new();
    private readonly ChairSpot[] _chairs = OfficePlaces.Chairs(map);
    private readonly Lock _lock = new();

    public IEnumerable<Bot> All => _bots.Values;

    public bool TryGet(string userId, out Bot bot) => _bots.TryGetValue(userId, out bot!);

    /// <summary>
    /// Ghi nhận hoạt động; trả về bot + true nếu bot vừa được ĐẶT (online / đổi bàn vì đổi khu — client gỡ avatar rồi thêm lại).
    /// Đổi đang làm ↔ rảnh thì bot đi bộ (Path) — không tính là "đặt".
    /// </summary>
    public (Bot Bot, bool Placed) Record(BotActivity a, DateTimeOffset now)
    {
        var id = a.UserId.ToString();
        lock (_lock)
        {
            var isNew = !_bots.TryGetValue(id, out var bot);
            bot ??= new Bot { UserId = id };
            bot.Name = a.Name.Length > 100 ? a.Name[..100] : a.Name;
            bot.Look = a.Look;
            bot.LastAt = now;
            var flipped = ApplyWork(bot, a, now);
            bot.Activity = Bubble(bot, a.Activity);
            var leftExplicit = flipped && !isNew && bot.Explicit;
            if (leftExplicit)
            {
                // Chỗ go_to giữ tới khi bot đổi giữa đang làm ↔ rảnh (chủ dự án 2026-11-13)
                bot.Explicit = false;
                _remembered.TryRemove(id, out _);
            }
            var placed = false;
            if (isNew && _remembered.TryGetValue(id, out var keep) && !Taken(id, keep.SpotKey))
            {
                (bot.Zone, bot.Explicit) = (a.Zone, true);
                Place(bot, keep);
                placed = true;
            }
            else if (isNew)
            {
                bot.Zone = a.Zone;
                // Vừa online mà đang rảnh → ngồi luôn ở Khu nghỉ (không chờ, không đi bộ)
                if (bot.Busy == false && RestSpot(id) is { } rest) { Place(bot, rest); bot.AtRest = true; }
                else Place(bot, DeskSpot(id, a.Zone));
                placed = true;
            }
            else if (!bot.Explicit && bot.Meeting is null)
            {
                var zoneChanged = bot.Zone != a.Zone;
                bot.Zone = a.Zone;
                if (bot.Busy == true && (bot.AtRest || leftExplicit)) WalkTo(bot, DeskSpot(id, a.Zone), rest: false);
                else if (!bot.AtRest && (zoneChanged || bot.Spot is null)) { Place(bot, DeskSpot(id, a.Zone)); placed = true; }
                else if (!bot.AtRest) GoRestIfIdle(bot, now);
            }
            else bot.Zone = a.Zone;
            _bots[id] = bot;
            return (bot, placed);
        }
    }

    /// <summary>Cập nhật đang làm / rảnh. Trả true nếu vừa đổi giữa hai trạng thái đã biết (hoặc lần đầu biết).</summary>
    private static bool ApplyWork(Bot bot, BotActivity a, DateTimeOffset now)
    {
        if (a.FromRunner) bot.RunnerAt = now;
        else if (now - bot.RunnerAt <= Timeout) return false; // agent-runner vừa báo → không lấy trạng thái suy từ bảng việc
        if (a.Busy is not { } busy) return false;
        bot.Task = busy ? Clip(a.Task, BotWork.MaxTask) : null;
        if (bot.Busy == busy) return false;
        bot.Busy = busy;
        bot.IdleSince = busy ? null : now;
        return true;
    }

    /// <summary>
    /// Bong bóng trên đầu: đang làm → "🛠 WEB-12 · thao tác" (thao tác đã ghi mã việc thì giữ nguyên); rảnh → "☕ Đang nghỉ"
    /// (trừ nói chuyện / đi lại / trình chiếu — vẫn hiện như cũ); chưa rõ → thao tác.
    /// </summary>
    internal static string Bubble(Bot bot, string activity)
    {
        activity = activity.Length > 120 ? activity[..120] : activity;
        if (bot.Meeting is not null)
            return activity.StartsWith("💬") || activity.StartsWith("🖥") || activity.StartsWith("📝") ? activity
                : bot.Path.Count > 0 && bot.Activity.StartsWith("🚶") ? bot.Activity : MeetingBubble(bot);
        if (bot.Busy == false)
            return activity.StartsWith("💬") || activity.StartsWith("🚶") || activity.StartsWith("🖥") || activity.StartsWith("📝") ? activity : BotWork.IdleBubble;
        if (bot.Busy == true && bot.Task is { Length: > 0 } task)
        {
            var code = task.Split(' ')[0];
            if (activity.Contains(code, StringComparison.OrdinalIgnoreCase) || activity.StartsWith("💬") || activity.StartsWith("🚶")) return activity;
            var line = $"🛠 {task}";
            return string.IsNullOrWhiteSpace(activity) || activity == task ? line : Clip($"🛠 {code} · {activity}", 120)!;
        }
        return activity;
    }

    private static string? Clip(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? null : (s = s.Trim()).Length > max ? s[..max] + "…" : s;

    /// <summary>
    /// Gọi định kỳ (<c>BotSweeper</c>, 15 giây): bot rảnh đủ <see cref="BotWork.IdleDelaySeconds"/> giây mà chưa ở chỗ nghỉ → bắt đầu đi ra Khu nghỉ.
    /// Trả các bot vừa bắt đầu đi.
    /// </summary>
    public List<Bot> Settle(DateTimeOffset now)
    {
        var moved = new List<Bot>();
        lock (_lock)
            foreach (var b in _bots.Values)
                if (!b.Explicit && b.Meeting is null && !b.AtRest && GoRestIfIdle(b, now)) moved.Add(b);
        return moved;
    }

    private bool GoRestIfIdle(Bot bot, DateTimeOffset now)
    {
        if (bot.Busy != false || bot.IdleSince is not { } since || (now - since).TotalSeconds < BotWork.IdleDelaySeconds) return false;
        if (presence.TryGet(bot.UserId, out _)) return false; // người thật đang dùng tài khoản → không có avatar bot để đi
        return RestSpot(bot.UserId) is { } rest && WalkTo(bot, rest, rest: true);
    }

    /// <summary>Đi bộ tới <paramref name="spot"/> (A*). Không có đường → đứng yên, trả false.</summary>
    private bool WalkTo(Bot bot, BotSpot spot, bool rest)
    {
        if (!PlanPath(bot, spot, out _)) return false;
        bot.Spot = spot;
        bot.AtRest = rest;
        bot.Anim = bot.Path.Count > 0 ? (byte)1 : (spot.Sit ? (byte)2 : (byte)0);
        bot.Dirty = true;
        return true;
    }

    /// <summary>Đường đi từ chỗ bot tới <paramref name="spot"/> vào <see cref="Bot.Path"/>; false = không có đường.</summary>
    private bool PlanPath(Bot bot, BotSpot spot, out double distance)
    {
        distance = 0;
        var path = map.Nav.FindPath(bot.X, bot.Z, spot.X, spot.Z);
        if (path.Count == 0 && Math.Abs(bot.X - spot.X) + Math.Abs(bot.Z - spot.Z) > 0.3) return false;
        bot.Path.Clear();
        foreach (var p in path) bot.Path.Enqueue(p);
        // Ngồi bàn / ghế: điểm cuối đường đi là ô trống cạnh ghế → bước nốt vào đúng chỗ ngồi
        if (spot.Sit && (path.Count == 0 || Math.Abs(path[^1].X - spot.X) + Math.Abs(path[^1].Z - spot.Z) > 0.01)) bot.Path.Enqueue((spot.X, spot.Z));
        double px = bot.X, pz = bot.Z;
        foreach (var p in bot.Path) { distance += Math.Sqrt((p.X - px) * (p.X - px) + (p.Z - pz) * (p.Z - pz)); (px, pz) = (p.X, p.Z); }
        return true;
    }

    /// <summary>Chỗ nghỉ: ghế / beanbag trống ở Khu nghỉ → Pantry (theo băm userId) → đứng trong Khu nghỉ. null = bản đồ không có chỗ nghỉ.</summary>
    private BotSpot? RestSpot(string userId)
    {
        var hash = StableHash(userId);
        var rooms = RestRooms.Select(id => map.Rooms.FirstOrDefault(r => r.Id == id)).OfType<Room>().ToArray();
        foreach (var room in rooms)
        {
            var chairs = _chairs.Where(c => room.Contains(c.X, c.Z) && !Taken(userId, c.Id)).ToArray();
            if (chairs.Length == 0) continue;
            var c = chairs[(int)(hash % (uint)chairs.Length)];
            return new BotSpot(c.X, c.Z, c.Angle, true, c.Id, room.Name, room.Walls ? room.Id : null);
        }
        return rooms.FirstOrDefault() is { } first ? StandNear((first.X0 + first.X1) / 2, (first.Z0 + first.Z1) / 2, first.Name, first.Walls ? first.Id : null) : null;
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
            if (bot.Meeting is { } meet)
                return $"Bot đang dự cuộc họp agent ở {map.Rooms.FirstOrDefault(r => r.Id == meet.RoomId)?.Name ?? meet.RoomId} — họp xong mới đi chỗ khác được";
            var spot = SpotFor(bot, place);
            if (spot is null) return $"Không còn chỗ trống ở {place.Name}";
            if (!PlanPath(bot, spot, out distance)) return $"Không có đường tới {place.Name}";
            bot.Spot = spot;
            bot.Explicit = true;
            bot.AtRest = map.Rooms.Any(r => RestRooms.Contains(r.Id) && r.Contains(spot.X, spot.Z));
            _remembered[userId] = spot;
            bot.Anim = bot.Path.Count > 0 ? (byte)1 : (spot.Sit ? (byte)2 : (byte)0);
            bot.Dirty = true;
            return null;
        }
    }

    /// <summary>Bong bóng khi đang dự họp (đã tới phòng): giữ lượt → <see cref="SpeakingBubble"/>, không thì "👥 Đang họp · chủ đề".</summary>
    internal static string MeetingBubble(Bot bot) =>
        bot.Speaking ? SpeakingBubble : Clip($"👥 Đang họp · {bot.Meeting?.Topic}", 120)!;

    /// <summary>
    /// Đồng bộ với các phiên họp agent đang họp (Realtime hỏi Api mỗi <see cref="AgentMeetingLiveRoute.PollSeconds"/> giây — TEST-76):
    /// bot dự họp chưa vào → đi bộ vào ghế trống trong phòng họp (chưa online → hiện ở lối vào rồi đi; coi là online suốt phiên); đổi người giữ lượt
    /// → đổi bong bóng; phiên kết thúc / bot không còn dự → bỏ giữ chỗ, đi bộ về bàn (rảnh đủ lâu → Khu nghỉ). Người thật của tài khoản đang trong
    /// văn phòng → bỏ qua (không có avatar bot riêng, bot vẫn dự họp qua chat). Trả bot vừa được ĐẶT (client thêm avatar) và bot đổi bong bóng.
    /// </summary>
    public (List<Bot> Placed, List<Bot> Status) SyncMeetings(IReadOnlyList<AgentMeetingLive> live, DateTimeOffset now)
    {
        var placed = new List<Bot>();
        var status = new List<Bot>();
        lock (_lock)
        {
            var attending = new Dictionary<string, (AgentMeetingLive Meeting, string Name)>();
            foreach (var m in live)
                foreach (var b in m.Bots) attending.TryAdd(b.UserId.ToString(), (m, b.Name));

            foreach (var bot in _bots.Values)
            {
                if (bot.Meeting is not { } meet || (attending.TryGetValue(bot.UserId, out var still) && still.Meeting.SessionId == meet.SessionId)) continue;
                LeaveMeeting(bot, now);
                status.Add(bot);
            }

            foreach (var (id, (m, name)) in attending)
            {
                if (presence.TryGet(id, out _)) continue;
                if (map.Rooms.FirstOrDefault(r => r.Id == m.RoomId) is not { } room) continue;
                if (!_bots.TryGetValue(id, out var bot))
                {
                    bot = new Bot { UserId = id, Name = name.Length > 100 ? name[..100] : name, LastAt = now };
                    Place(bot, new BotSpot(map.Spawn.X, map.Spawn.Z, 0, false, null, "lối vào", null));
                    _bots[id] = bot;
                    placed.Add(bot);
                }
                bot.LastAt = now; // dự họp = online suốt phiên (không bị BotSweeper xoá vì 5 phút không gọi tool)
                var speaking = m.SpeakerUserId?.ToString() == id;
                if (bot.Meeting?.SessionId != m.SessionId)
                {
                    if (SpotFor(bot, new OfficePlace(room.Id, "room", room.Name)) is not { } spot || !WalkTo(bot, spot, rest: false)) continue; // thử lại lần hỏi sau
                    bot.Meeting = new BotMeeting(m.SessionId, room.Id, m.Topic);
                    bot.Explicit = false; // chỗ go_to cũ hết giữ — họp xong về bàn / Khu nghỉ
                    _remembered.TryRemove(id, out _);
                    bot.Speaking = speaking;
                    bot.Activity = bot.Path.Count > 0 ? $"🚶 {room.Name}" : MeetingBubble(bot);
                    status.Add(bot);
                }
                else if (bot.Speaking != speaking)
                {
                    bot.Speaking = speaking;
                    // Vừa hết lượt: tin vừa nói ("💬 …") vẫn hiện như cũ
                    bot.Activity = !speaking && bot.Activity.StartsWith("💬") ? bot.Activity
                        : bot.Path.Count > 0 && !speaking ? bot.Activity : MeetingBubble(bot);
                    status.Add(bot);
                }
                else if (bot.Path.Count == 0 && bot.Activity.StartsWith("🚶"))
                {
                    bot.Activity = MeetingBubble(bot); // vừa tới chỗ trong phòng họp
                    status.Add(bot);
                }
            }
        }
        return (placed, status);
    }

    /// <summary>Hết phiên họp: bỏ giữ chỗ, rảnh đủ lâu → Khu nghỉ, không thì về bàn (đi bộ).</summary>
    private void LeaveMeeting(Bot bot, DateTimeOffset now)
    {
        bot.Meeting = null;
        bot.Speaking = false;
        if (!GoRestIfIdle(bot, now)) WalkTo(bot, DeskSpot(bot.UserId, bot.Zone), rest: false);
        bot.Activity = bot.Spot is { } s && bot.Path.Count > 0 ? $"🚶 {s.PlaceName}" : Bubble(bot, bot.Task ?? "");
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
