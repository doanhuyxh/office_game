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

    // ── Đang làm / rảnh (2026-11-13): đang làm → bàn, rảnh ≥ 60 s → Khu nghỉ ──

    private static BotActivity Work(Guid id, bool busy, string activity = "Việc của tôi", string? task = "WEB-12 · Sửa form", bool runner = false) =>
        new(id, "Bot", null, "dept-kd", activity, busy, busy ? task : null, runner);

    /// <summary>Chỗ của bot nằm trong phòng nào (khu mở "open" phủ lên Khu nghỉ → ưu tiên phòng được hỏi).</summary>
    private static bool In(Bot b, string roomId) => Map.Rooms.Any(r => r.Id == roomId && r.Contains(b.Spot!.X, b.Spot.Z));

    [Fact]
    public void Idle_bot_coming_online_sits_in_the_lounge_and_busy_bot_at_its_desk()
    {
        var bots = new BotPresence(Map, new Presence());
        var (idle, _) = bots.Record(Work(Guid.NewGuid(), false), T0);
        Assert.True(In(idle, "lounge"));
        Assert.True(idle.AtRest);
        Assert.Equal(2, idle.Anim);
        Assert.Equal(BotWork.IdleBubble, idle.Activity);

        var (busy, _) = bots.Record(Work(Guid.NewGuid(), true), T0);
        Assert.Equal("dept-kd", SeatOf(busy).Zone);
        Assert.Equal("🛠 WEB-12 · Việc của tôi", busy.Activity);
    }

    [Fact]
    public void Bot_walks_to_the_lounge_only_after_being_idle_for_a_minute_and_back_to_the_desk_at_once()
    {
        var bots = new BotPresence(Map, new Presence());
        var id = Guid.NewGuid();
        var (bot, _) = bots.Record(Work(id, true), T0);
        var desk = bot.Spot!.SpotKey;

        bots.Record(Work(id, false), T0.AddSeconds(5));
        Assert.Empty(bots.Settle(T0.AddSeconds(30)));               // chưa đủ 60 s → vẫn ở bàn
        Assert.Equal(desk, bot.Spot!.SpotKey);
        bots.Record(Work(id, true), T0.AddSeconds(40));               // có việc lại trước 60 s → không đi đâu
        Assert.Empty(bots.Settle(T0.AddSeconds(120)));

        bots.Record(Work(id, false), T0.AddSeconds(130));
        Assert.Single(bots.Settle(T0.AddSeconds(200)));
        Assert.Equal(1, bot.Anim);                                    // đi bộ, không dịch chuyển
        Assert.True(WalkUntilArrived(bots, bot, out var valid));
        Assert.True(valid);
        Assert.True(In(bot, "lounge"));
        Assert.Empty(bots.Settle(T0.AddSeconds(300)));                // đã ở chỗ nghỉ

        var (_, placed) = bots.Record(Work(id, true), T0.AddSeconds(310));
        Assert.False(placed);
        Assert.Equal(1, bot.Anim);
        Assert.True(WalkUntilArrived(bots, bot, out _));
        Assert.Equal(desk, bot.Spot!.SpotKey);
    }

    [Fact]
    public void Runner_state_wins_over_the_task_board_for_five_minutes()
    {
        var bots = new BotPresence(Map, new Presence());
        var id = Guid.NewGuid();
        var (bot, _) = bots.Record(Work(id, true, "Sửa code", runner: true), T0);
        Assert.Equal("🛠 WEB-12 · Sửa code", bot.Activity);
        bots.Record(Work(id, false, "Thông báo của tôi"), T0.AddMinutes(1));     // bảng việc nói rảnh → bỏ qua
        Assert.True(bot.Busy);
        Assert.Equal("🛠 WEB-12 · Thông báo của tôi", bot.Activity);
        bots.Record(Work(id, false, "Thông báo của tôi"), T0.AddMinutes(7));     // runner im > 5 phút → theo bảng việc
        Assert.False(bot.Busy);
        Assert.Equal(BotWork.IdleBubble, bot.Activity);
    }

    [Fact]
    public void Idle_bubble_keeps_chat_and_walking_lines()
    {
        var bots = new BotPresence(Map, new Presence());
        var id = Guid.NewGuid();
        bots.Record(Work(id, false), T0);
        Assert.Equal("💬 Chào mọi người", bots.Record(Work(id, false, "💬 Chào mọi người"), T0).Bot.Activity);
        Assert.Equal("Chuyển trạng thái việc · WEB-12", bots.Record(Work(id, true, "Chuyển trạng thái việc · WEB-12"), T0).Bot.Activity);
        // Không rõ (Api lỗi) → giữ trạng thái cũ, bong bóng theo trạng thái đó
        Assert.Equal("🛠 WEB-12 · Đọc tài liệu", bots.Record(new BotActivity(id, "Bot", null, "dept-kd", "Đọc tài liệu"), T0).Bot.Activity);
    }

    [Fact]
    public void Go_to_spot_is_kept_until_the_bot_switches_between_working_and_idle()
    {
        var bots = new BotPresence(Map, new Presence());
        var id = Guid.NewGuid();
        var (bot, _) = bots.Record(Work(id, true), T0);
        var desk = bot.Spot!.SpotKey;
        Assert.Null(bots.GoTo(id.ToString(), PlaceOf("meeting-small"), out _));
        WalkUntilArrived(bots, bot, out _);
        bots.Record(Work(id, true, "Trình bày"), T0.AddMinutes(1));
        Assert.True(In(bot, "meeting-small"));                   // vẫn đang làm → ở lại

        bots.Record(Work(id, false), T0.AddMinutes(2));               // xong việc → hết giữ chỗ, rảnh đủ lâu → Khu nghỉ
        Assert.False(bot.Explicit);
        Assert.Single(bots.Settle(T0.AddMinutes(4)));
        WalkUntilArrived(bots, bot, out _);
        Assert.True(In(bot, "lounge"));

        Assert.Null(bots.GoTo(id.ToString(), PlaceOf("meeting-small"), out _));
        WalkUntilArrived(bots, bot, out _);
        bots.Record(Work(id, true), T0.AddMinutes(5));                // có việc mới → về bàn ngay
        WalkUntilArrived(bots, bot, out _);
        Assert.Equal(desk, bot.Spot!.SpotKey);
    }

    [Fact]
    public void Full_lounge_overflows_to_the_pantry_and_nobody_shares_a_chair()
    {
        var bots = new BotPresence(Map, new Presence());
        var all = Enumerable.Range(0, 40).Select(_ => bots.Record(Work(Guid.NewGuid(), false), T0).Bot).ToList();
        Assert.Contains(all, b => In(b, "lounge"));
        Assert.Contains(all, b => In(b, "pantry"));
        var seated = all.Where(b => b.Spot!.Sit).Select(b => b.Spot!.SpotKey).ToList();
        Assert.Equal(seated.Count, seated.Distinct().Count());
    }

    // ── Họp agent (TEST-76) ──

    private static AgentMeetingLive Meeting(Guid session, Guid? speaker, params Guid[] bots) =>
        new(session, "meeting-small", "Phòng họp nhỏ", "Kế hoạch quý", 3, 30, T0.AddMinutes(30), speaker,
            bots.Select((b, i) => new AgentMeetingLiveBot(b, $"Bot {i}")).ToList());

    /// <summary>Cho mọi bot đi tới khi không còn ai đang đi (tối đa 200 giây mô phỏng).</summary>
    private static bool WalkAll(BotPresence bots)
    {
        for (var i = 0; i < 2000 && bots.All.Any(b => b.Path.Count > 0); i++) bots.Step(0.1);
        return bots.All.All(b => b.Path.Count == 0);
    }

    private sealed class FakeContext : Microsoft.AspNetCore.SignalR.HubCallerContext
    {
        public override string ConnectionId => "c1";
        public override string? UserIdentifier => null;
        public override System.Security.Claims.ClaimsPrincipal? User => null;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override Microsoft.AspNetCore.Http.Features.IFeatureCollection Features { get; } = new Microsoft.AspNetCore.Http.Features.FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() { }
    }

    [Fact]
    public void Meeting_bots_walk_into_the_room_even_when_offline_and_stay_while_the_session_runs()
    {
        var bots = new BotPresence(Map, new Presence());
        var (a, b, session) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var (busy, _) = bots.Record(Work(a, true), T0);               // a đang làm ở bàn, b chưa online
        var desk = busy.Spot!.SpotKey;

        var (placed, status) = bots.SyncMeetings([Meeting(session, a, a, b)], T0);
        Assert.True(bots.TryGet(b.ToString(), out var offline));
        Assert.Equal([offline], placed);                              // b hiện ở lối vào rồi đi vào
        Assert.Equal(2, status.Count);
        Assert.Equal(1, busy.Anim);                                   // đi bộ, không dịch chuyển
        Assert.Equal(1, offline.Anim);
        Assert.StartsWith("🚶", offline.Activity);
        Assert.True(WalkAll(bots));
        Assert.True(In(busy, "meeting-small") && In(offline, "meeting-small"));
        Assert.NotEqual(busy.Spot!.SpotKey, offline.Spot!.SpotKey);    // mỗi bot một ghế
        Assert.Equal("meeting-small", offline.Spot.RoomId);           // tới nơi → vào kênh chat phòng

        // Trong phiên: đổi đang làm ↔ rảnh, tool khác, go_to, hết 5 phút không gọi tool → vẫn ở phòng họp
        bots.Record(Work(a, false), T0.AddMinutes(1));
        Assert.Empty(bots.Settle(T0.AddMinutes(5)));
        Assert.NotNull(bots.GoTo(a.ToString(), PlaceOf("lounge"), out _));
        Assert.Empty(busy.Path);
        bots.SyncMeetings([Meeting(session, a, a, b)], T0.AddMinutes(10));
        Assert.Empty(bots.Expire(T0.AddMinutes(12)));
        Assert.True(In(busy, "meeting-small") && In(offline, "meeting-small"));
        Assert.NotEqual(desk, busy.Spot!.SpotKey);
    }

    [Fact]
    public void Speaker_bubble_follows_the_turn_and_the_last_message_stays()
    {
        var bots = new BotPresence(Map, new Presence());
        var (a, b, session) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        bots.SyncMeetings([Meeting(session, a, a, b)], T0);
        bots.TryGet(a.ToString(), out var chair);
        bots.TryGet(b.ToString(), out var other);
        Assert.True(WalkAll(bots));
        bots.SyncMeetings([Meeting(session, a, a, b)], T0);           // vừa tới chỗ → bong bóng họp
        Assert.Equal(BotPresence.SpeakingBubble, chair.Activity);
        Assert.Equal(BotPresence.InMeetingBubble, other.Activity); // TEST-89: không ghi chủ đề

        Assert.Equal(BotPresence.SpeakingBubble, bots.Record(Work(a, true, "Xem phiên họp"), T0).Bot.Activity); // tool khác không che dấu đang nói
        Assert.Equal("💬 Đề xuất A", bots.Record(Work(a, true, "💬 Đề xuất A"), T0).Bot.Activity);

        var (_, status) = bots.SyncMeetings([Meeting(session, b, a, b)], T0.AddSeconds(3)); // lượt sang b
        Assert.Equal(2, status.Count);
        Assert.Equal("💬 Đề xuất A", chair.Activity);                  // tin vừa nói vẫn hiện
        Assert.Equal(BotPresence.SpeakingBubble, other.Activity);
    }

    [Fact]
    public void Ending_the_session_releases_bots_back_to_their_desk_or_the_lounge()
    {
        var bots = new BotPresence(Map, new Presence());
        var (a, b, session) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var (busy, _) = bots.Record(Work(a, true), T0);
        var desk = busy.Spot!.SpotKey;
        var (idle, _) = bots.Record(Work(b, false), T0);
        bots.SyncMeetings([Meeting(session, null, a, b)], T0);
        Assert.True(WalkAll(bots));

        var (_, status) = bots.SyncMeetings([], T0.AddMinutes(10));    // dừng / hết trần
        Assert.Equal(2, status.Count);
        Assert.Null(busy.Meeting);
        Assert.StartsWith("🚶", busy.Activity);
        Assert.True(WalkAll(bots));
        Assert.Equal(desk, busy.Spot!.SpotKey);                       // đang làm → về bàn
        Assert.True(In(idle, "lounge"));                              // rảnh lâu → Khu nghỉ
        Assert.Empty(bots.SyncMeetings([], T0.AddMinutes(11)).Status);  // không lặp lại
        Assert.Null(bots.GoTo(a.ToString(), PlaceOf("meeting-small"), out _)); // hết họp → go_to lại được
    }

    [Fact]
    public void Bot_account_used_by_a_person_in_the_office_is_not_moved()
    {
        var presence = new Presence();
        var bots = new BotPresence(Map, presence);
        var (a, b, session) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        presence.Add(new Player { UserId = a.ToString(), Name = "Người thật", ConnectionId = "c1", Context = new FakeContext() });
        var (placed, _) = bots.SyncMeetings([Meeting(session, a, a, b)], T0);
        Assert.False(bots.TryGet(a.ToString(), out _));               // không tạo avatar bot thứ hai
        Assert.Single(placed);
        Assert.True(bots.TryGet(b.ToString(), out var other) && other.Meeting is not null);
    }
}
