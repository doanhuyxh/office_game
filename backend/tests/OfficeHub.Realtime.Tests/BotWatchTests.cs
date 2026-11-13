using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Tests;

/// <summary>
/// Xem trực tiếp bot đang làm gì (TEST-95): chỉ trong phạm vi nghe được (luật voice — cùng kênh; phòng họp cả phòng, còn lại ≤ 6 m);
/// đệm + sự kiện mới chỉ tới người đang xem; ra ngoài phạm vi (+1 m) quá 3 giây / bot offline → ngắt.
/// </summary>
public class BotWatchTests
{
    private static readonly OfficeMap Map = OfficeMap.Load(FindMap());
    private static readonly DateTimeOffset T0 = new(2026, 11, 14, 3, 0, 0, TimeSpan.Zero);

    private static string FindMap()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "shared", "office-map.json"))) return Path.Combine(d.FullName, "shared", "office-map.json");
        throw new InvalidOperationException("Không tìm thấy shared/office-map.json");
    }

    private sealed class World
    {
        public readonly Presence Presence = new();
        public readonly BotPresence Bots;
        public readonly BotActivityFeed Feed = new();
        public readonly BotWatch Watch;

        public World()
        {
            Bots = new BotPresence(Map, Presence);
            Watch = new BotWatch(Presence, Bots, Map, Feed);
        }

        /// <summary>Người xem đứng tại (x, z) — mặc định khu mở (lobby).</summary>
        public Player Viewer(double x = 25, double z = 29, string id = "viewer", string conn = "c1")
        {
            var p = new Player { UserId = id, Name = "Người xem", ConnectionId = conn, Context = new FakeContext(conn), X = (float)x, Z = (float)z };
            Presence.Add(p);
            return p;
        }

        /// <summary>Bot online rồi kéo tới đúng (x, z) để kiểm phạm vi.</summary>
        public Bot Bot(Guid id, double x, double z, bool? busy = true)
        {
            var (bot, _) = Bots.Record(new BotActivity(id, "Bot", null, null, "Đang code", busy, busy == true ? "TEST-95 · Hub xem bot" : null, FromRunner: true), T0);
            (bot.X, bot.Z) = ((float)x, (float)z);
            bot.Path.Clear();
            return bot;
        }
    }

    private static BotActivityEvent Ev(string id, string kind = "command", bool? ok = null) => new(id, kind, Title: "Chạy lệnh", Text: "echo hi", Ok: ok);

    private sealed class FakeContext(string conn) : Microsoft.AspNetCore.SignalR.HubCallerContext
    {
        public override string ConnectionId => conn;
        public override string? UserIdentifier => null;
        public override System.Security.Claims.ClaimsPrincipal? User => null;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; } = new Microsoft.AspNetCore.Http.Features.FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() { }
    }

    // ── Phạm vi nghe được (OfficeMap.CanHear) ──

    [Fact]
    public void Hearing_follows_voice_rules()
    {
        Assert.True(Map.CanHear(25, 29, 27, 29));   // khu mở, cách 2 m
        Assert.False(Map.CanHear(25, 29, 35, 29));  // khu mở, cách 10 m > 6 m
        Assert.True(Map.CanHear(25, 29, 32, 29, slack: 1)); // 7 m, trong trễ +1 m
        Assert.True(Map.CanHear(11, 1, 21, 7));     // cùng hội trường (voice "room") — cả phòng dù > 6 m
        Assert.False(Map.CanHear(5, 9, 5, 7));      // đứng ngoài tường phòng Giám đốc, cách 2 m → khác kênh
        Assert.False(Map.CanHear(41, 1, 49, 7));    // cùng phòng focus (tường, KHÔNG phải voice "room") nhưng cách 10 m
    }

    // ── WatchBot ──

    [Fact]
    public void Watch_in_range_returns_snapshot_then_streams_new_events_only_to_watcher()
    {
        var w = new World();
        w.Viewer();
        var botId = Guid.NewGuid();
        w.Bot(botId, 27, 29);
        w.Feed.Append(botId.ToString(), [Ev("e1"), Ev("e2")], T0);

        var (dto, err) = w.Watch.Start("c1", "viewer", botId.ToString());
        Assert.Null(err);
        Assert.Equal(["e1", "e2"], dto!.Events.Select(e => e.Id));
        Assert.True(dto.Busy);
        Assert.Equal("TEST-95 · Hub xem bot", dto.Task);

        w.Feed.Append(botId.ToString(), [Ev("e3")], T0.AddSeconds(1));
        var pushes = w.Watch.Flush();
        var (conn, push) = Assert.Single(pushes);
        Assert.Equal("c1", conn);
        Assert.Equal(botId.ToString(), push.BotId);
        Assert.Equal(["e3"], push.Events.Select(e => e.Id));
        Assert.True(push.Busy);
        Assert.Empty(w.Watch.Flush()); // không có gì mới → không gửi
    }

    [Fact]
    public void Update_with_same_id_replaces_pending_event_and_keeps_seq()
    {
        var w = new World();
        w.Viewer();
        var botId = Guid.NewGuid();
        w.Bot(botId, 27, 29);
        w.Watch.Start("c1", "viewer", botId.ToString());

        w.Feed.Append(botId.ToString(), [Ev("cmd")], T0);
        var seq = w.Feed.Snapshot(botId.ToString()).Single().Seq;
        w.Feed.Append(botId.ToString(), [Ev("cmd", ok: true)], T0.AddSeconds(2)); // kết quả lệnh về sau — cập nhật theo id
        var (_, push) = Assert.Single(w.Watch.Flush());
        var e = Assert.Single(push.Events);
        Assert.True(e.Ok);
        Assert.Equal(seq, e.Seq);
    }

    [Fact]
    public void Out_of_range_or_wrong_channel_or_not_a_bot_is_refused()
    {
        var w = new World();
        var viewer = w.Viewer();
        var far = Guid.NewGuid();
        w.Bot(far, 35, 29); // khu mở nhưng cách 10 m
        Assert.Equal("Hãy lại gần hơn để xem", w.Watch.Start("c1", "viewer", far.ToString()).Error);

        var walled = Guid.NewGuid();
        w.Bot(walled, 25, 7);        // trong phòng họp lớn
        (viewer.X, viewer.Z) = (25f, 9f); // đứng ngoài tường, cách 2 m nhưng khác kênh
        Assert.Equal("Hãy lại gần hơn để xem", w.Watch.Start("c1", "viewer", walled.ToString()).Error);

        Assert.NotNull(w.Watch.Start("c1", "viewer", Guid.NewGuid().ToString()).Error); // không phải bot
        Assert.NotNull(w.Watch.Start("c1", "ai-đó", Guid.NewGuid().ToString()).Error);  // chưa vào hub
    }

    [Fact]
    public void Same_meeting_room_is_watchable_from_any_distance()
    {
        var w = new World();
        w.Viewer(11, 1); // hội trường (voice "room"), chéo phòng > 6 m
        var botId = Guid.NewGuid();
        w.Bot(botId, 21, 7);
        Assert.Null(w.Watch.Start("c1", "viewer", botId.ToString()).Error);
    }

    [Fact]
    public void Bot_whose_human_is_in_office_cannot_be_watched()
    {
        var w = new World();
        w.Viewer();
        var botId = Guid.NewGuid();
        w.Bot(botId, 27, 29);
        w.Viewer(27, 29, id: botId.ToString(), conn: "c9"); // người thật của tài khoản bot đang trong 3D
        Assert.Equal("Người này không phải bot đang hiện trong văn phòng", w.Watch.Start("c1", "viewer", botId.ToString()).Error);
    }

    [Fact]
    public void Switching_bot_stops_the_old_stream_and_unwatch_stops_everything()
    {
        var w = new World();
        w.Viewer();
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        w.Bot(a, 27, 29);
        w.Bot(b, 24, 29);
        w.Watch.Start("c1", "viewer", a.ToString());
        w.Watch.Start("c1", "viewer", b.ToString()); // đổi bot — mỗi kết nối một bot
        w.Feed.Append(a.ToString(), [Ev("a1")], T0);
        w.Feed.Append(b.ToString(), [Ev("b1")], T0);
        var (_, push) = Assert.Single(w.Watch.Flush());
        Assert.Equal(b.ToString(), push.BotId);
        Assert.Equal(["b1"], push.Events.Select(e => e.Id));

        w.Watch.Stop("c1");
        w.Feed.Append(b.ToString(), [Ev("b2")], T0);
        Assert.Empty(w.Watch.Flush());
    }

    // ── Trạng thái + đệm bị xoá ──

    [Fact]
    public void Busy_flip_and_feed_clear_are_pushed_to_the_watcher()
    {
        var w = new World();
        w.Viewer();
        var botId = Guid.NewGuid();
        w.Bot(botId, 27, 29);
        w.Watch.Start("c1", "viewer", botId.ToString());

        w.Bots.Record(new BotActivity(botId, "Bot", null, null, "Đang nghỉ", Busy: false, null, FromRunner: true), T0.AddMinutes(1));
        var (_, push) = Assert.Single(w.Watch.Flush());
        Assert.False(push.Busy);
        Assert.Null(push.Task);
        Assert.Empty(push.Events);

        w.Feed.Append(botId.ToString(), [Ev("e1")], T0.AddMinutes(1));
        w.Watch.Flush();
        w.Feed.Clear(botId.ToString()); // rảnh quá lâu → BotSweeper xoá đệm
        (_, push) = Assert.Single(w.Watch.Flush());
        Assert.True(push.Cleared);
        Assert.Empty(push.Events);
    }

    // ── Tự ngắt (Sweep mỗi giây) ──

    [Fact]
    public void Leaving_range_ends_after_grace_with_one_meter_slack()
    {
        var w = new World();
        var viewer = w.Viewer();
        var botId = Guid.NewGuid();
        w.Bot(botId, 27, 29);
        w.Watch.Start("c1", "viewer", botId.ToString());

        viewer.X = 33.5f; // cách 6,5 m — quá 6 m nhưng trong trễ +1 m → vẫn xem
        Assert.Empty(w.Watch.Sweep(T0));

        viewer.X = 36f;   // cách 9 m — ngoài 7 m
        Assert.Empty(w.Watch.Sweep(T0.AddSeconds(1)));          // bắt đầu đếm
        viewer.X = 28f;   // quay lại trong 3 giây → không ngắt, đếm lại
        Assert.Empty(w.Watch.Sweep(T0.AddSeconds(2)));

        viewer.X = 36f;
        Assert.Empty(w.Watch.Sweep(T0.AddSeconds(3)));
        Assert.Empty(w.Watch.Sweep(T0.AddSeconds(5.5)));        // mới 2,5 giây
        var (conn, endedBot, reason) = Assert.Single(w.Watch.Sweep(T0.AddSeconds(6)));
        Assert.Equal(("c1", botId.ToString(), BotWatch.EndedRange), (conn, endedBot, reason));
        Assert.Empty(w.Watch.Sweep(T0.AddSeconds(7))); // đã ngắt rồi
    }

    [Fact]
    public void Bot_going_offline_or_viewer_leaving_ends_the_watch()
    {
        var w = new World();
        var viewer = w.Viewer();
        var botId = Guid.NewGuid();
        w.Bot(botId, 27, 29);
        w.Watch.Start("c1", "viewer", botId.ToString());
        w.Bots.Expire(T0.AddMinutes(6)); // quá 5 phút không gọi tool
        Assert.Equal(BotWatch.EndedOffline, Assert.Single(w.Watch.Sweep(T0.AddMinutes(6))).Reason);

        w.Bot(botId, 27, 29);
        w.Watch.Start("c1", "viewer", botId.ToString());
        w.Presence.Remove("viewer", viewer.ConnectionId); // người xem rời văn phòng
        Assert.Equal(BotWatch.EndedLeft, Assert.Single(w.Watch.Sweep(T0.AddMinutes(7))).Reason);
        Assert.Empty(w.Watch.Flush());
    }
}
