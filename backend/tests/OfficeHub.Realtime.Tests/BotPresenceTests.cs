using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Tests;

/// <summary>Bot trong văn phòng 3D: xếp bàn theo khu phòng ban, giữ bàn ổn định, hết hạn sau 5 phút, đi bộ tới chỗ (go_to).</summary>
public class BotPresenceTests
{
    private static readonly OfficeMap Map = OfficeMap.Load(FindMap());
    private static readonly DateTimeOffset T0 = new(2026, 11, 10, 3, 0, 0, TimeSpan.Zero);

    private static string FindMap()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "shared", "office-map.json"))) return Path.Combine(d.FullName, "shared", "office-map.json");
        throw new InvalidOperationException("Không tìm thấy shared/office-map.json");
    }

    private static BotActivity Act(Guid id, string? zone, string activity = "Việc của tôi") => new(id, "Bot", null, zone, activity);
    private static Seat SeatOf(Bot b) => Map.Seats.First(s => s.Id == b.Spot!.SpotKey);
    private static OfficePlace PlaceOf(string id) => OfficePlaces.List(Map, []).First(p => p.Id == id);

    /// <summary>Cho bot đi tới khi tới nơi (tối đa 200 giây mô phỏng); mọi vị trí trên đường đều đứng được.</summary>
    private static bool WalkUntilArrived(BotPresence bots, Bot bot, out bool alwaysValid)
    {
        alwaysValid = true;
        for (var i = 0; i < 2000; i++)
        {
            var arrived = bots.Step(0.1);
            if (bot.Anim == 1 && !Map.CanStand(bot.X, bot.Z) && !Map.Nav.NearestFree(bot.X, bot.Z).HasValue) alwaysValid = false;
            if (arrived.Contains(bot)) return true;
        }
        return false;
    }

    [Fact]
    public void Bot_sits_in_its_department_zone()
    {
        var bots = new BotPresence(Map, new Presence());
        var (bot, placed) = bots.Record(Act(Guid.NewGuid(), "dept-kd"), T0);
        Assert.True(placed);
        Assert.Equal("dept-kd", SeatOf(bot).Zone);
    }

    [Fact]
    public void Bot_without_zone_uses_shared_work_area()
    {
        var bots = new BotPresence(Map, new Presence());
        var (bot, _) = bots.Record(Act(Guid.NewGuid(), null), T0);
        Assert.Equal(BotPresence.SharedZone, SeatOf(bot).Zone);
    }

    [Fact]
    public void Same_user_gets_same_seat_again_and_activity_updates_without_moving()
    {
        var id = Guid.NewGuid();
        var first = new BotPresence(Map, new Presence()).Record(Act(id, "dept-kd"), T0).Bot.Spot!.SpotKey;
        var bots = new BotPresence(Map, new Presence());
        Assert.Equal(first, bots.Record(Act(id, "dept-kd"), T0).Bot.Spot!.SpotKey);
        var (bot, placed) = bots.Record(Act(id, "dept-kd", "Chuyển trạng thái việc · WEB-12"), T0.AddMinutes(1));
        Assert.False(placed);
        Assert.Equal("Chuyển trạng thái việc · WEB-12", bot.Activity);
    }

    [Fact]
    public void Bots_never_share_a_seat_and_overflow_to_shared_area()
    {
        var bots = new BotPresence(Map, new Presence());
        var kdSeats = Map.Seats.Count(s => s.Zone == "dept-kd");
        var seats = Enumerable.Range(0, kdSeats + 2).Select(_ => bots.Record(Act(Guid.NewGuid(), "dept-kd"), T0).Bot).Select(SeatOf).ToList();
        Assert.Equal(seats.Count, seats.Select(s => s.Id).Distinct().Count());
        Assert.Equal(2, seats.Count(s => s.Zone == BotPresence.SharedZone));
    }

    [Fact]
    public void Bot_expires_after_five_minutes_without_activity()
    {
        var bots = new BotPresence(Map, new Presence());
        var id = Guid.NewGuid();
        bots.Record(Act(id, "dept-kd"), T0);
        Assert.Empty(bots.Expire(T0.AddMinutes(BotActivityRoute.OnlineMinutes)));
        Assert.Single(bots.Expire(T0.AddMinutes(BotActivityRoute.OnlineMinutes).AddSeconds(1)));
        Assert.False(bots.TryGet(id.ToString(), out _));
    }

    [Fact]
    public void Internal_key_must_match()
    {
        Assert.True(BotActivityRoute.KeyMatches("k", "k"));
        Assert.False(BotActivityRoute.KeyMatches("k", "x"));
        Assert.False(BotActivityRoute.KeyMatches("", ""));
        Assert.False(BotActivityRoute.KeyMatches(null, "k"));
    }

    [Fact]
    public void Path_points_are_walkable_and_end_at_target()
    {
        var cell = Map.Nav.NearestFree(26, 4)!.Value;          // ô đứng được trong phòng họp lớn
        var (tx, tz) = Map.Nav.Center(cell.I, cell.J);
        var path = Map.Nav.FindPath(Map.Spawn.X, Map.Spawn.Z, tx, tz);
        Assert.NotEmpty(path);
        Assert.All(path, p => Assert.True(Map.Nav.Walkable(p.X, p.Z), $"({p.X}, {p.Z}) không đi được"));
        Assert.True(Math.Abs(path[^1].X - tx) < 0.01 && Math.Abs(path[^1].Z - tz) < 0.01, $"điểm cuối ({path[^1].X}, {path[^1].Z})");
        for (var i = 1; i < path.Count; i++) Assert.True(Map.Nav.ClearLine(path[i - 1], path[i], 0.22), $"đoạn {i} cắt qua vật cản");
    }

    [Fact]
    public void Bot_walks_to_meeting_room_and_sits_on_a_chair_inside()
    {
        var bots = new BotPresence(Map, new Presence());
        var id = Guid.NewGuid().ToString();
        var (bot, _) = bots.Record(Act(Guid.Parse(id), "dept-kth"), T0);
        var start = (bot.X, bot.Z);
        Assert.Null(bots.GoTo(id, PlaceOf("meeting-small"), out var distance));
        Assert.True(distance > 1, $"quãng đường {distance}");
        Assert.Equal(1, bot.Anim); // đang đi
        Assert.True(WalkUntilArrived(bots, bot, out _));
        var room = Map.Rooms.First(r => r.Id == "meeting-small");
        Assert.True(room.Contains(bot.X, bot.Z), $"bot ở ({bot.X}, {bot.Z})");
        Assert.Equal(2, bot.Anim);                 // ngồi ghế phòng họp
        Assert.Equal("meeting-small", bot.Spot!.RoomId); // → báo Api cấp kênh chat phòng
        Assert.NotEqual(start, (bot.X, bot.Z));
    }

    [Fact]
    public void Bot_stays_after_go_to_even_when_zone_changes_and_is_remembered_after_going_offline()
    {
        var bots = new BotPresence(Map, new Presence());
        var gid = Guid.NewGuid();
        var id = gid.ToString();
        var (bot, _) = bots.Record(Act(gid, "dept-kth"), T0);
        bots.GoTo(id, PlaceOf("pantry"), out _);
        WalkUntilArrived(bots, bot, out _);
        var at = (bot.X, bot.Z);
        var (_, placed) = bots.Record(Act(gid, "dept-kd"), T0.AddMinutes(1)); // đổi phòng ban → vẫn ở pantry
        Assert.False(placed);
        Assert.Equal(at, (bot.X, bot.Z));
        bots.Expire(T0.AddMinutes(10));
        var (again, placedAgain) = bots.Record(Act(gid, "dept-kd"), T0.AddMinutes(11)); // online lại → hiện ở pantry, không về bàn
        Assert.True(placedAgain);
        Assert.Equal(at, (again.X, again.Z));
    }

    [Fact]
    public void Two_bots_do_not_take_the_same_chair()
    {
        var bots = new BotPresence(Map, new Presence());
        var a = bots.Record(Act(Guid.NewGuid(), null), T0).Bot;
        var b = bots.Record(Act(Guid.NewGuid(), null), T0).Bot;
        bots.GoTo(a.UserId, PlaceOf("booth-1"), out _);
        bots.GoTo(b.UserId, PlaceOf("booth-1"), out _);
        Assert.NotEqual(a.Spot!.SpotKey ?? "a", b.Spot!.SpotKey ?? "b");
    }

    [Fact]
    public void Bot_walks_back_to_its_desk()
    {
        var bots = new BotPresence(Map, new Presence());
        var gid = Guid.NewGuid();
        var (bot, _) = bots.Record(Act(gid, "dept-kd"), T0);
        var desk = bot.Spot!.SpotKey;
        bots.GoTo(gid.ToString(), PlaceOf("lobby"), out _);
        WalkUntilArrived(bots, bot, out _);
        bots.GoTo(gid.ToString(), PlaceOf(OfficePlaces.DeskId), out _);
        Assert.True(WalkUntilArrived(bots, bot, out _));
        Assert.Equal(desk, bot.Spot!.SpotKey);
        Assert.Equal(2, bot.Anim);
    }

    [Theory]
    [InlineData("phong hop nho", "meeting-small")]
    [InlineData("Phòng họp nhỏ", "meeting-small")]
    [InlineData("meeting-large", "meeting-large")]
    [InlineData("bàn của tôi", "desk")]
    [InlineData("Công nghệ", "dept-kth")]
    [InlineData("cạnh Lan Anh", "u1")]
    public void Resolve_place(string query, string expected)
    {
        var places = OfficePlaces.List(Map, [("u1", "Lan Anh"), ("u2", "Huy")]);
        Assert.Equal(expected, OfficePlaces.Resolve(query, places, out _)?.Id);
    }

    [Fact]
    public void Ambiguous_or_unknown_place()
    {
        var places = OfficePlaces.List(Map, []);
        Assert.Null(OfficePlaces.Resolve("phòng gọi", places, out var many));
        Assert.Equal(4, many.Count);
        Assert.Null(OfficePlaces.Resolve("sao hỏa", places, out var none));
        Assert.Empty(none);
    }
}
