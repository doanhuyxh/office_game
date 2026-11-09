using OfficeHub.Api;
using OfficeHub.BuildingBlocks.Hosting;

namespace OfficeHub.Architecture.Tests;

/// <summary>Trang Hệ thống → Vận hành: ghi nhận lần chạy job nền và suy ra trạng thái.</summary>
public class JobMonitorTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 9, 1, 0, 0, TimeSpan.Zero);

    private sealed class FakeTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    [Fact]
    public async Task Records_success_and_failure()
    {
        var clock = new FakeTimeProvider(T0);
        var monitor = new JobMonitor(clock);
        var job = monitor.Register("x", "Việc X", TimeSpan.FromHours(1));
        Assert.Same(job, monitor.Register("x", "Việc X", TimeSpan.FromHours(1)));

        await job.RunAsync(() => Task.CompletedTask);
        var s = Assert.Single(monitor.Snapshot());
        Assert.True(s.LastSucceeded);
        Assert.Equal(1, s.Runs);
        Assert.Equal(0, s.Failures);
        Assert.False(s.Running);

        await Assert.ThrowsAsync<InvalidOperationException>(() => job.RunAsync(() => throw new InvalidOperationException("SMTP hỏng")));
        s = monitor.Snapshot()[0];
        Assert.False(s.LastSucceeded);
        Assert.Equal("SMTP hỏng", s.LastError);
        Assert.Equal(2, s.Runs);
        Assert.Equal(1, s.Failures);
        Assert.Equal("failing", OpsReport.JobState(s, T0));
    }

    [Fact]
    public async Task Cancellation_is_not_a_failure()
    {
        var job = new JobMonitor(new FakeTimeProvider(T0)).Register("x", "X", TimeSpan.FromMinutes(5));
        await Assert.ThrowsAsync<OperationCanceledException>(() => job.RunAsync(() => throw new OperationCanceledException()));
    }

    [Fact]
    public async Task State_waiting_ok_late()
    {
        var clock = new FakeTimeProvider(T0);
        var monitor = new JobMonitor(clock);
        var job = monitor.Register("x", "X", TimeSpan.FromHours(1));
        Assert.Equal("waiting", OpsReport.JobState(monitor.Snapshot()[0], T0.AddMinutes(1)));
        Assert.Equal("late", OpsReport.JobState(monitor.Snapshot()[0], T0.AddHours(2).AddMinutes(6)));
        await job.RunAsync(() => Task.CompletedTask);
        Assert.Equal("ok", OpsReport.JobState(monitor.Snapshot()[0], T0.AddHours(1)));
        Assert.Equal("late", OpsReport.JobState(monitor.Snapshot()[0], T0.AddHours(3)));
    }
}

public class BuildInfoTests
{
    [Theory]
    [InlineData("1.0.0+e958b01cf9be6dd679e21136141eeeeff78a4693", "e958b01")]
    [InlineData("1.0.0", null)]
    [InlineData("1.0.0+local", null)]
    public void CommitFromVersion(string version, string? expected) => Assert.Equal(expected, OpsReport.CommitFromVersion(version));
}
