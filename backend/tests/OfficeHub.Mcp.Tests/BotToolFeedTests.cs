using System.Text.Json;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Mcp.Infrastructure;

namespace OfficeHub.Mcp.Tests;

/// <summary>
/// Bot không chạy qua agent-runner tự phát sự kiện "tool" + session_start / session_end vào luồng hoạt động (TEST-96);
/// runner đang hoạt động (presence / /mcp/activity trong 5 phút) → không phát.
/// </summary>
public class BotToolFeedTests
{
    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static readonly DateTimeOffset T0 = new(2026, 11, 14, 3, 0, 0, TimeSpan.Zero);
    private static readonly Guid Bot = Guid.NewGuid();

    [Fact]
    public void First_call_opens_session_then_only_tool_events()
    {
        var feed = new BotToolFeed(new FakeTimeProvider(T0));

        var first = feed.OnToolCall(Bot, "get_task", "Chi tiết việc", "TEST-5 · Sửa lỗi", "TEST-5", ok: true);
        Assert.NotNull(first);
        Assert.Equal(2, first.Count);
        Assert.Equal(BotActivityFeedRoute.SessionStart, first[0].Kind);
        Assert.Equal("TEST-5 · Sửa lỗi", first[0].Task);
        Assert.Equal("tool", first[1].Kind);
        Assert.Equal("Chi tiết việc", first[1].Title);
        Assert.Equal("get_task TEST-5", first[1].Text);
        Assert.True(first[1].Ok);
        // Không gửi gì ngoài tiêu đề + tên tool + mã việc
        Assert.Null(first[1].Path);
        Assert.Null(first[1].Diff);
        Assert.Null(first[1].Output);

        var second = feed.OnToolCall(Bot, "list_my_tasks", "Việc của tôi", "TEST-5 · Sửa lỗi", null, ok: false);
        Assert.NotNull(second);
        var ev = Assert.Single(second);
        Assert.Equal("tool", ev.Kind);
        Assert.Equal("list_my_tasks", ev.Text);
        Assert.False(ev.Ok);
        Assert.NotEqual(first[1].Id, ev.Id);
    }

    [Fact]
    public void Runner_active_suppresses_and_drops_open_session()
    {
        var clock = new FakeTimeProvider(T0);
        var feed = new BotToolFeed(clock);
        Assert.NotNull(feed.OnToolCall(Bot, "get_task", "Chi tiết việc", null, null, ok: true)); // phiên tự mở

        feed.RunnerSeen(Bot); // runner báo presence / gửi /mcp/activity
        Assert.Null(feed.OnToolCall(Bot, "get_task", "Chi tiết việc", null, null, ok: true));
        clock.Now = T0.AddMinutes(BotWork.TaskWindowMinutes + 1);
        Assert.Empty(feed.Sweep()); // phiên tự mở đã bị bỏ khi runner xuất hiện → không có session_end đè lên đệm của runner

        // Hết hiệu lực 5 phút (tính từ lần runner báo) → tự phát lại, mở phiên mới
        clock.Now = T0.AddMinutes(BotActivityRoute.OnlineMinutes + BotWork.TaskWindowMinutes + 2);
        var events = feed.OnToolCall(Bot, "get_task", "Chi tiết việc", null, null, ok: true);
        Assert.NotNull(events);
        Assert.Equal(BotActivityFeedRoute.SessionStart, events[0].Kind);
    }

    [Fact]
    public void Sweep_ends_idle_session_after_task_window()
    {
        var clock = new FakeTimeProvider(T0);
        var feed = new BotToolFeed(clock);
        feed.OnToolCall(Bot, "get_task", "Chi tiết việc", "TEST-5 · Sửa lỗi", "TEST-5", ok: true);

        clock.Now = T0.AddMinutes(BotWork.TaskWindowMinutes - 1);
        Assert.Empty(feed.Sweep()); // chưa hết cửa sổ
        feed.OnToolCall(Bot, "list_my_tasks", "Việc của tôi", null, null, ok: true); // đụng tool → tính lại

        clock.Now = clock.Now.AddMinutes(BotWork.TaskWindowMinutes);
        var ended = Assert.Single(feed.Sweep());
        Assert.Equal(Bot, ended.UserId);
        Assert.Equal(BotActivityFeedRoute.SessionEnd, ended.Event.Kind);
        Assert.Equal("TEST-5 · Sửa lỗi", ended.Event.Task); // giữ việc gần nhất đã biết
        Assert.Empty(feed.Sweep()); // đã quên phiên

        // Lần gọi tool sau đó mở phiên mới
        var events = feed.OnToolCall(Bot, "get_task", "Chi tiết việc", null, null, ok: true);
        Assert.NotNull(events);
        Assert.Equal(BotActivityFeedRoute.SessionStart, events[0].Kind);
    }

    [Fact]
    public void Events_pass_gate_validation()
    {
        var feed = new BotToolFeed(new FakeTimeProvider(T0));
        var events = feed.OnToolCall(Bot, "get_task", "Chi tiết việc", "TEST-5 · Sửa lỗi", "TEST-5", ok: true)!;
        Assert.Null(BotActivityGate.Validate(events));
        Assert.All(events, e => Assert.True(e.Id.Length <= BotActivityFeedRoute.MaxId));
    }

    private static Dictionary<string, JsonElement> Args(string key, string value) =>
        new() { [key] = JsonDocument.Parse(JsonSerializer.Serialize(value)).RootElement };

    [Fact]
    public void Task_code_comes_only_from_task_argument()
    {
        Assert.Equal("TEST-5", BotPresenceReporter.TaskCodeOf("get_task", Args("task", " test-5 "), null));
        // Tham số là id → lấy mã từ nhãn đã biết; nhãn mặc định "Việc" / chưa biết → bỏ
        var id = Guid.NewGuid().ToString();
        Assert.Equal("TEST-5", BotPresenceReporter.TaskCodeOf("get_task", Args("task", id), "TEST-5 · Sửa lỗi"));
        Assert.Null(BotPresenceReporter.TaskCodeOf("get_task", Args("task", id), "Việc"));
        Assert.Null(BotPresenceReporter.TaskCodeOf("get_task", Args("task", id), null));
        // Tool không thao tác trên việc / không có tham số task → không có mã
        Assert.Null(BotPresenceReporter.TaskCodeOf("get_project", Args("project", "TEST"), null));
        Assert.Null(BotPresenceReporter.TaskCodeOf("list_my_tasks", null, "TEST-5 · Sửa lỗi"));
    }
}
