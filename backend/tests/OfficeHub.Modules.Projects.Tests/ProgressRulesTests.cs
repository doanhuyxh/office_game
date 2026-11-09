using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

/// <summary>Tổng quan tiến độ: % hoàn thành, % thời gian, mốc tiếp theo, tình trạng Đúng tiến độ / Có rủi ro / Trễ.</summary>
public class ProgressRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 9);
    private static DateOnly D(int offset) => Today.AddDays(offset);
    private static ProgressTask T(TaskState s, int? dueOffset = null) => new(s, dueOffset is { } o ? D(o) : null);
    private static ProjectProgress Run(ProgressTask[] tasks, ProgressMilestone[]? ms = null, DateOnly? start = null, DateOnly? end = null, bool active = true) =>
        ProgressRules.Compute(tasks, ms ?? [], start, end, active, Today);

    [Fact]
    public void Counts_And_Percent()
    {
        var p = Run([T(TaskState.Todo), T(TaskState.Doing), T(TaskState.Review), T(TaskState.Done)]);
        Assert.Equal((1, 1, 1, 1, 25), (p.Todo, p.Doing, p.Review, p.Done, p.PercentDone));
        Assert.Equal(ProjectHealth.OnTrack, p.Health);
        Assert.Empty(p.HealthReasons);
    }

    [Fact]
    public void NoTasks_PercentNull() => Assert.Null(Run([]).PercentDone);

    [Theory]
    [InlineData(-10, 10, 50)]
    [InlineData(5, 15, 0)]    // chưa bắt đầu
    [InlineData(-30, -1, 100)] // đã qua ngày kết thúc
    public void TimeElapsed(int start, int end, int expected) => Assert.Equal(expected, Run([], start: D(start), end: D(end)).TimeElapsedPercent);

    [Fact]
    public void TimeElapsed_NullWithoutDates() => Assert.Null(Run([], start: D(-5)).TimeElapsedPercent);

    [Fact]
    public void NextMilestone_EarliestOpen()
    {
        var p = Run([], [new(1, "Xong", D(-5), MilestoneStatus.Accepted), new(2, "B", D(20), MilestoneStatus.Open), new(3, "A", D(3), MilestoneStatus.Open)]);
        Assert.Equal("A", p.NextMilestone!.Title);
        Assert.False(p.NextMilestone.Overdue);
    }

    [Fact]
    public void OverdueMilestone_IsLate()
    {
        var p = Run([], [new(1, "Bàn giao", D(-1), MilestoneStatus.Open)]);
        Assert.Equal(ProjectHealth.Late, p.Health);
        Assert.True(p.NextMilestone!.Overdue);
        Assert.Equal(1, p.MilestonesOverdue);
    }

    [Fact]
    public void OneOverdueTask_AmongMany_IsAtRisk() =>
        Assert.Equal(ProjectHealth.AtRisk, Run([T(TaskState.Todo, -1), .. Enumerable.Range(0, 9).Select(_ => T(TaskState.Todo))]).Health);

    [Fact]
    public void ManyOverdueTasks_IsLate() =>
        Assert.Equal(ProjectHealth.Late, Run([T(TaskState.Todo, -1), T(TaskState.Doing, -2), T(TaskState.Review, -3), T(TaskState.Todo)]).Health);

    [Fact]
    public void DoneTaskPastDue_NotOverdue() => Assert.Equal(0, Run([T(TaskState.Done, -5)]).Overdue);

    [Fact]
    public void PastEndWithOpenTasks_IsLate() => Assert.Equal(ProjectHealth.Late, Run([T(TaskState.Todo)], start: D(-30), end: D(-1)).Health);

    [Fact]
    public void TimeAheadOfProgress_IsAtRisk()
    {
        // 50% thời gian, 0% việc xong
        var p = Run([T(TaskState.Todo), T(TaskState.Doing)], start: D(-30), end: D(30));
        Assert.Equal(ProjectHealth.AtRisk, p.Health);
        Assert.Contains(p.HealthReasons, r => r.Contains("thời gian"));
    }

    [Fact]
    public void EndingSoon_LowProgress_IsAtRisk() =>
        Assert.Equal(ProjectHealth.AtRisk, Run([T(TaskState.Done), T(TaskState.Todo), T(TaskState.Todo), T(TaskState.Todo)], start: D(-1), end: D(10)).Health);

    [Fact]
    public void Closed_NoHealth() => Assert.Null(Run([T(TaskState.Todo, -3)], active: false).Health);
}
