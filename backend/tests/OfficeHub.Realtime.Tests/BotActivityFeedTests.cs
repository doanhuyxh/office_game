using Microsoft.AspNetCore.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Realtime.Hubs;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Tests;

/// <summary>Luồng "agent đang làm gì" (TEST-92): cập nhật theo id, vòng đệm 200, cắt độ dài, vòng đời đệm theo phiên / offline, endpoint nội bộ.</summary>
public class BotActivityFeedTests
{
    private const string Bot = "bot-a";
    private static readonly string Key = new('k', 40);
    private static readonly DateTimeOffset T0 = new(2026, 11, 14, 3, 0, 0, TimeSpan.Zero);

    private static BotActivityEvent Ev(string id, string kind = "command", string? text = null) => new(id, kind, Title: "Chạy lệnh", Text: text);

    private static BotActivityEvent Clean(BotActivityEvent e) => BotActivityFeed.Clean(e, out var err) ?? throw new InvalidOperationException(err);

    private static int Status(IResult r) => ((IStatusCodeHttpResult)r).StatusCode ?? 200;

    [Fact]
    public void Adds_events_with_server_seq_and_time_and_updates_by_id()
    {
        var feed = new BotActivityFeed();
        var saved = feed.Append(Bot, [Ev("c1", text: "dotnet test") with { Seq = 99, At = T0.AddDays(-1) }, Ev("t1", "thinking", "Nghĩ")], T0);
        Assert.Equal([1L, 2L], saved.Select(e => e.Seq));
        Assert.All(saved, e => Assert.Equal(T0, e.At));

        var upd = feed.Append(Bot, [new BotActivityEvent("c1", "command", Output: "Passed!", Ok: true)], T0.AddSeconds(5)).Single();
        Assert.Equal(1, upd.Seq);                  // giữ seq + giờ gốc
        Assert.Equal(T0, upd.At);
        Assert.Equal("dotnet test", upd.Text);     // trường null giữ giá trị cũ
        Assert.Equal("Passed!", upd.Output);
        Assert.True(upd.Ok);
        var snap = feed.Snapshot(Bot);
        Assert.Equal(["c1", "t1"], snap.Select(e => e.Id));
        Assert.Equal("Passed!", snap[0].Output);
    }

    [Fact]
    public void Keeps_only_last_200_events()
    {
        var feed = new BotActivityFeed();
        feed.Append(Bot, Enumerable.Range(1, 250).Select(i => Ev($"e{i}")), T0);
        var snap = feed.Snapshot(Bot);
        Assert.Equal(BotActivityFeedRoute.BufferSize, snap.Count);
        Assert.Equal("e51", snap[0].Id);
        Assert.Equal(250, snap[^1].Seq);
    }

    [Fact]
    public void Session_start_clears_old_buffer_and_session_end_clears_after_notifying()
    {
        var feed = new BotActivityFeed();
        var heard = new List<BotActivityEvent>();
        feed.Appended += (_, e) => heard.Add(e);
        feed.Append(Bot, [Ev("a"), Ev("b")], T0);
        feed.Append(Bot, [new BotActivityEvent("s2", BotActivityFeedRoute.SessionStart, Task: "TEST-92 · Luồng"), Ev("c")], T0);
        Assert.Equal(["s2", "c"], feed.Snapshot(Bot).Select(e => e.Id));

        feed.Append(Bot, [new BotActivityEvent("s2", BotActivityFeedRoute.SessionEnd, Turns: 12, CostUsd: 0.42m)], T0);
        Assert.Empty(feed.Snapshot(Bot));
        Assert.Equal(BotActivityFeedRoute.SessionEnd, heard[^1].Kind);
        Assert.Equal(5, heard[^1].Seq); // seq vẫn tăng qua các phiên
    }

    [Fact]
    public void Offline_or_idle_bot_buffer_is_cleared()
    {
        var feed = new BotActivityFeed();
        var cleared = new List<string>();
        feed.Cleared += cleared.Add;
        feed.Append(Bot, [Ev("a")], T0);
        feed.Append("bot-b", [Ev("b")], T0.AddMinutes(4));

        Assert.True(feed.Clear(Bot)); // BotSweeper: bot offline
        Assert.Empty(feed.Snapshot(Bot));
        Assert.False(feed.Clear(Bot));

        Assert.Empty(feed.Sweep(T0.AddMinutes(8)));                // bot-b mới rảnh 4 phút
        Assert.Equal(["bot-b"], feed.Sweep(T0.AddMinutes(9).AddSeconds(1)));
        Assert.Empty(feed.Snapshot("bot-b"));
        Assert.Equal([Bot, "bot-b"], cleared);
    }

    [Fact]
    public void Cuts_long_fields_instead_of_rejecting()
    {
        var diff = string.Join('\n', Enumerable.Range(1, 500).Select(i => $"+dòng {i}"));
        var e = Clean(new BotActivityEvent(new string('i', 100), "file_edit", Title: new string('t', 500), Text: new string('x', 10_000),
            Path: new string('p', 1_000), Diff: diff, Output: new string('o', 9_000) + "CUỐI"));
        Assert.Equal(BotActivityFeedRoute.MaxId, e.Id.Length);
        Assert.Equal(BotActivityFeedRoute.MaxTitle, e.Title!.Length);
        Assert.Equal(BotActivityFeedRoute.MaxText, e.Text!.Length);
        Assert.Equal(BotActivityFeedRoute.MaxPath, e.Path!.Length);
        Assert.Equal(BotActivityFeedRoute.MaxDiffLines, e.Diff!.Split('\n').Length);
        Assert.StartsWith("+dòng 1\n", e.Diff);
        Assert.Equal(BotActivityFeedRoute.MaxOutput, e.Output!.Length);
        Assert.EndsWith("CUỐI", e.Output);    // output giữ phần cuối
        Assert.StartsWith("…", e.Output);

        var big = Clean(new BotActivityEvent("d", "file_edit", Diff: new string('+', 20_000)));
        Assert.Equal(BotActivityFeedRoute.MaxDiffChars, big.Diff!.Length);
    }

    [Fact]
    public void Strips_control_characters_but_keeps_newlines_and_tabs()
    {
        var e = Clean(new BotActivityEvent("x\u0000", "say", Title: "a\nb\u001b[31m", Text: "dòng 1\r\n\tdòng 2\u0007", Output: "   "));
        Assert.Equal("x", e.Id);
        Assert.Equal("a b [31m", e.Title);        // một dòng: xuống dòng → dấu cách
        Assert.Equal("dòng 1\n\tdòng 2", e.Text);
        Assert.Null(e.Output);
    }

    [Theory]
    [InlineData("screenshot")]
    [InlineData("COMMAND")]
    [InlineData("")]
    public void Unknown_kind_is_rejected(string kind)
    {
        Assert.Null(BotActivityFeed.Clean(new BotActivityEvent("a", kind), out var err));
        Assert.Contains("kind không hợp lệ", err);
    }

    [Fact]
    public void Endpoint_checks_key_kind_and_batch_size()
    {
        var feed = new BotActivityFeed();
        var uid = Guid.NewGuid();
        BotActivityBatch Batch(params BotActivityEvent[] es) => new(uid, es);

        Assert.Equal(401, Status(BotActivityFeedEndpoints.Receive(Batch(Ev("a")), "sai", Key, feed, T0)));
        Assert.Equal(401, Status(BotActivityFeedEndpoints.Receive(Batch(Ev("a")), "", Key, feed, T0)));
        Assert.Equal(400, Status(BotActivityFeedEndpoints.Receive(Batch(Ev("a"), Ev("b", "video")), Key, Key, feed, T0)));
        Assert.Empty(feed.Snapshot(uid.ToString()));  // lô lỗi không ghi gì
        Assert.Equal(400, Status(BotActivityFeedEndpoints.Receive(new BotActivityBatch(Guid.Empty, [Ev("a")]), Key, Key, feed, T0)));
        Assert.Equal(400, Status(BotActivityFeedEndpoints.Receive(Batch(), Key, Key, feed, T0)));
        Assert.Equal(400, Status(BotActivityFeedEndpoints.Receive(Batch(Enumerable.Range(0, 51).Select(i => Ev($"e{i}")).ToArray()), Key, Key, feed, T0)));

        Assert.Equal(200, Status(BotActivityFeedEndpoints.Receive(Batch(Ev("a"), Ev("b", "file_read")), Key, Key, feed, T0)));
        Assert.Equal(2, feed.Snapshot(uid.ToString()).Count);
    }

    [Fact]
    public void Internal_guard_allows_larger_body_for_activity_feed() =>
        Assert.Equal(InternalRouteGuard.ActivityFeedMaxBody, InternalRouteGuard.MaxBodyFor(BotActivityFeedRoute.Path));
}
