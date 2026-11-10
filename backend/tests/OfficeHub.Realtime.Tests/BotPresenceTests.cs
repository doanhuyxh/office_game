using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Tests;

/// <summary>Bot trong văn phòng 3D: xếp bàn theo khu phòng ban, giữ bàn ổn định, hết hạn sau 5 phút.</summary>
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

    [Fact]
    public void Bot_sits_in_its_department_zone()
    {
        var bots = new BotPresence(Map, new Presence());
        var (bot, placed) = bots.Record(Act(Guid.NewGuid(), "dept-kd"), T0);
        Assert.True(placed);
        Assert.Equal("dept-kd", bot.Seat!.Zone);
    }

    [Fact]
    public void Bot_without_zone_uses_shared_work_area()
    {
        var bots = new BotPresence(Map, new Presence());
        var (bot, _) = bots.Record(Act(Guid.NewGuid(), null), T0);
        Assert.Equal(BotPresence.SharedZone, bot.Seat!.Zone);
    }

    [Fact]
    public void Same_user_gets_same_seat_again_and_activity_updates_without_moving()
    {
        var id = Guid.NewGuid();
        var first = new BotPresence(Map, new Presence()).Record(Act(id, "dept-kd"), T0).Bot.Seat!.Id;
        var bots = new BotPresence(Map, new Presence());
        Assert.Equal(first, bots.Record(Act(id, "dept-kd"), T0).Bot.Seat!.Id);
        var (bot, placed) = bots.Record(Act(id, "dept-kd", "Chuyển trạng thái việc · WEB-12"), T0.AddMinutes(1));
        Assert.False(placed);
        Assert.Equal("Chuyển trạng thái việc · WEB-12", bot.Activity);
    }

    [Fact]
    public void Bots_never_share_a_seat_and_overflow_to_shared_area()
    {
        var bots = new BotPresence(Map, new Presence());
        var kdSeats = Map.Seats.Count(s => s.Zone == "dept-kd");
        var seats = Enumerable.Range(0, kdSeats + 2).Select(_ => bots.Record(Act(Guid.NewGuid(), "dept-kd"), T0).Bot.Seat!).ToList();
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
}
