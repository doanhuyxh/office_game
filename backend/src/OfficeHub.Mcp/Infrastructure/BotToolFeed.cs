using OfficeHub.BuildingBlocks.Office;

namespace OfficeHub.Mcp.Infrastructure;

/// <summary>
/// Bot KHÔNG chạy qua agent-runner (kết nối MCP trực tiếp) vẫn có gì để xem trong bảng "agent đang làm gì" (TEST-96):
/// mỗi lần tài khoản bot gọi tool → sự kiện <c>kind: "tool"</c> vào luồng của bot (tiêu đề tiếng Việt của tool + tên tool
/// + mã việc nếu tham số có <c>task</c> — KHÔNG gửi tham số khác / kết quả tool: có thể chứa dữ liệu nhân sự / tài chính).
/// Lần gọi tool đầu sau khi rảnh → tự phát <c>session_start</c>; quá <see cref="BotWork.TaskWindowMinutes"/> phút không gọi
/// tool → <c>session_end</c> (quét bởi <see cref="BotToolFeedSweeper"/>). Runner đang báo trạng thái (<see cref="BotWork.PresencePath"/>)
/// hoặc vừa gửi <see cref="BotActivityFeedRoute.McpPath"/> trong <see cref="BotActivityRoute.OnlineMinutes"/> phút
/// → KHÔNG tự phát (runner đã gửi sự kiện <c>tool</c> của chính nó). Chỉ RAM, thread-safe.
/// </summary>
public sealed class BotToolFeed(TimeProvider clock)
{
    private sealed class Session
    {
        public DateTimeOffset LastTool;
        public string? Task;
    }

    private readonly object _lock = new();
    private readonly Dictionary<Guid, DateTimeOffset> _runnerSeen = [];
    private readonly Dictionary<Guid, Session> _sessions = [];

    /// <summary>
    /// agent-runner vừa báo presence / gửi lô sự kiện cho bot này → runner làm chủ luồng trong <see cref="BotActivityRoute.OnlineMinutes"/> phút:
    /// thôi tự phát và quên phiên tự mở (không gửi <c>session_end</c> — đệm trên Realtime giờ là của runner).
    /// </summary>
    public void RunnerSeen(Guid userId)
    {
        lock (_lock)
        {
            _runnerSeen[userId] = clock.GetUtcNow();
            _sessions.Remove(userId);
        }
    }

    /// <summary>
    /// Bot vừa gọi tool → các sự kiện cần phát (<c>session_start</c> nếu là lần đầu sau khi rảnh + <c>tool</c>);
    /// null = không phát (runner đang hoạt động). <paramref name="taskLabel"/> = "MÃ · tên việc" đang làm theo BotWork (nếu có);
    /// <paramref name="taskCode"/> = mã việc khi tham số CỦA LẦN GỌI NÀY có <c>task</c>.
    /// </summary>
    public IReadOnlyList<BotActivityEvent>? OnToolCall(Guid userId, string tool, string title, string? taskLabel, string? taskCode, bool ok)
    {
        var now = clock.GetUtcNow();
        lock (_lock)
        {
            if (_runnerSeen.TryGetValue(userId, out var seen) && now - seen < TimeSpan.FromMinutes(BotActivityRoute.OnlineMinutes)) return null;
            var ev = new BotActivityEvent(NewId(), "tool", Title: title, Text: taskCode is null ? tool : $"{tool} {taskCode}", Ok: ok);
            if (_sessions.TryGetValue(userId, out var s))
            {
                s.LastTool = now;
                s.Task = taskLabel ?? s.Task;
                return [ev];
            }
            _sessions[userId] = new Session { LastTool = now, Task = taskLabel };
            return [new BotActivityEvent(NewId(), BotActivityFeedRoute.SessionStart, Task: taskLabel), ev];
        }
    }

    /// <summary>
    /// Phiên tự mở quá <see cref="BotWork.TaskWindowMinutes"/> phút không gọi tool → trả <c>session_end</c> cho từng bot (và quên phiên);
    /// dọn luôn dấu runner đã hết hạn.
    /// </summary>
    public IReadOnlyList<(Guid UserId, BotActivityEvent Event)> Sweep()
    {
        var now = clock.GetUtcNow();
        lock (_lock)
        {
            foreach (var id in _runnerSeen.Where(p => now - p.Value >= TimeSpan.FromMinutes(BotActivityRoute.OnlineMinutes)).Select(p => p.Key).ToList())
                _runnerSeen.Remove(id);
            var ended = new List<(Guid, BotActivityEvent)>();
            foreach (var (id, s) in _sessions.Where(p => now - p.Value.LastTool >= TimeSpan.FromMinutes(BotWork.TaskWindowMinutes)).ToList())
            {
                _sessions.Remove(id);
                ended.Add((id, new BotActivityEvent(NewId(), BotActivityFeedRoute.SessionEnd, Task: s.Task)));
            }
            return ended;
        }
    }

    private static string NewId() => "mcp-" + Guid.NewGuid().ToString("n"); // 36 ký tự ≤ MaxId 64
}

/// <summary>Quét định kỳ: phiên tự mở hết hạn → gửi <c>session_end</c> sang Realtime (lỗi chỉ ghi log, không có gì để làm lại).</summary>
public sealed class BotToolFeedSweeper(BotToolFeed feed, BotPresenceReporter reporter, ILogger<BotToolFeedSweeper> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
        {
            foreach (var (userId, ev) in feed.Sweep())
            {
                try
                {
                    await reporter.SendFeedAsync(userId, [ev]);
                }
                catch (Exception e)
                {
                    log.LogWarning("Gửi session_end cho Realtime thất bại: {Message}", e.Message);
                }
            }
        }
    }
}
