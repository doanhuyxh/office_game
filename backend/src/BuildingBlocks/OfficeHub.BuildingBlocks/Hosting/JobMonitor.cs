using System.Collections.Concurrent;
using System.Diagnostics;

namespace OfficeHub.BuildingBlocks.Hosting;

/// <summary>Trạng thái một job nền tại thời điểm hỏi (trang Hệ thống → Vận hành).</summary>
public sealed record JobStatus(string Key, string Name, TimeSpan Interval, DateTimeOffset RegisteredAt, DateTimeOffset? LastStartedAt,
    DateTimeOffset? LastFinishedAt, double? LastDurationMs, bool? LastSucceeded, string? LastError, DateTimeOffset? LastErrorAt, int Runs, int Failures,
    bool Running);

/// <summary>
/// Theo dõi job nền (<c>BackgroundService</c> chạy định kỳ) trong tiến trình hiện tại: lần chạy cuối, thành công / lỗi, lỗi gần nhất.
/// Chỉ trong bộ nhớ — khởi động lại tiến trình là đếm lại. Job gọi <see cref="Register"/> đầu <c>ExecuteAsync</c> rồi bọc mỗi lần chạy
/// bằng <see cref="JobHandle.RunAsync"/>. Đăng ký singleton trong <see cref="HostingExtensions.AddOfficeHubDefaults"/>.
/// </summary>
public sealed class JobMonitor(TimeProvider clock)
{
    private readonly ConcurrentDictionary<string, JobHandle> _jobs = new();

    /// <param name="key">Mã duy nhất (vd <c>assets.maintenance</c>).</param>
    /// <param name="name">Tên tiếng Việt hiển thị.</param>
    /// <param name="interval">Chu kỳ chạy — trang Vận hành báo "trễ" khi quá 2 chu kỳ chưa chạy.</param>
    public JobHandle Register(string key, string name, TimeSpan interval) =>
        _jobs.GetOrAdd(key, k => new JobHandle(k, name, interval, clock));

    public IReadOnlyList<JobStatus> Snapshot() => [.. _jobs.Values.Select(j => j.Status()).OrderBy(j => j.Name, StringComparer.Ordinal)];
}

public sealed class JobHandle
{
    private readonly Lock _gate = new();
    private readonly string _key;
    private readonly string _name;
    private readonly TimeSpan _interval;
    private readonly TimeProvider _clock;
    private readonly DateTimeOffset _registeredAt;
    private DateTimeOffset? _lastStarted, _lastFinished, _lastErrorAt;
    private double? _lastMs;
    private bool? _lastOk;
    private string? _lastError;
    private int _runs, _failures;
    private bool _running;

    internal JobHandle(string key, string name, TimeSpan interval, TimeProvider clock)
    {
        _key = key; _name = name; _interval = interval; _clock = clock; _registeredAt = clock.GetUtcNow();
    }

    /// <summary>Chạy một lần và ghi kết quả; lỗi được ghi lại rồi ném tiếp (job vẫn tự log như cũ). Huỷ do tắt máy không tính là lỗi.</summary>
    public async Task RunAsync(Func<Task> run)
    {
        var sw = Stopwatch.StartNew();
        lock (_gate) { _lastStarted = _clock.GetUtcNow(); _running = true; }
        try
        {
            await run();
            lock (_gate) { _lastOk = true; _runs++; }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            lock (_gate)
            {
                _lastOk = false; _runs++; _failures++;
                _lastError = ex.Message.Length > 500 ? ex.Message[..500] : ex.Message;
                _lastErrorAt = _clock.GetUtcNow();
            }
            throw;
        }
        finally
        {
            lock (_gate) { _running = false; _lastFinished = _clock.GetUtcNow(); _lastMs = Math.Round(sw.Elapsed.TotalMilliseconds); }
        }
    }

    internal JobStatus Status()
    {
        lock (_gate)
            return new(_key, _name, _interval, _registeredAt, _lastStarted, _lastFinished, _lastMs, _lastOk, _lastError, _lastErrorAt, _runs, _failures, _running);
    }
}
