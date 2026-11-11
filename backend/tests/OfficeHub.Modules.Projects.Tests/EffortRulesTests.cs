using OfficeHub.Modules.Projects.Domain;
using static OfficeHub.Modules.Projects.Domain.EffortRules;

namespace OfficeHub.Modules.Projects.Tests;

public class EffortRulesTests
{
    [Theory]
    [InlineData(0, 100)]
    [InlineData(1, 100)]
    [InlineData(2, 50)]
    [InlineData(3, 33.33)]
    public void Default_percent_splits_evenly(int projects, decimal expected) => Assert.Equal(expected, DefaultPercent(projects));

    [Fact]
    public void Explicit_percent_wins_over_default()
    {
        Assert.Equal(30, Percent(30, 1));
        Assert.Equal(0, Percent(0, 1));      // đặt 0 % = không tính công cho dự án này
        Assert.Equal(50, Percent(null, 2));
    }

    [Fact]
    public void Man_days_is_present_days_times_percent() => Assert.Equal(10.5m, ManDays(21, 50));

    [Fact]
    public void Active_in_month_respects_start_end_and_close()
    {
        var nov = new DateOnly(2026, 11, 1);
        Assert.True(ActiveIn(nov, new DateOnly(2026, 11, 30), null, null));          // bắt đầu cuối tháng
        Assert.False(ActiveIn(nov, new DateOnly(2026, 12, 1), null, null));
        Assert.False(ActiveIn(nov, new DateOnly(2026, 1, 1), new DateOnly(2026, 10, 31), null));
        Assert.True(ActiveIn(nov, new DateOnly(2026, 1, 1), null, new DateOnly(2026, 11, 1)));  // đóng ngày 1 vẫn tính tháng đó
        Assert.False(ActiveIn(nov, new DateOnly(2026, 1, 1), new DateOnly(2027, 1, 1), new DateOnly(2026, 10, 15)));
    }

    [Fact]
    public void Months_are_inclusive_and_capped()
    {
        Assert.Equal([new DateOnly(2026, 10, 1), new DateOnly(2026, 11, 1)], Months(new DateOnly(2026, 10, 20), new DateOnly(2026, 11, 3)));
        var many = Months(new DateOnly(2020, 1, 1), new DateOnly(2026, 11, 1));
        Assert.Equal(MaxMonths, many.Count);
        Assert.Equal(new DateOnly(2026, 11, 1), many[^1]);
    }

    [Fact]
    public void Allocation_total_cannot_exceed_100()
    {
        Assert.Null(CheckTotal(60, 40));
        Assert.NotNull(CheckTotal(61, 40));
        Assert.NotNull(CheckTotal(101, 0));
        Assert.NotNull(CheckTotal(-1, 0));
    }

    [Fact]
    public void Overdue_only_when_not_done()
    {
        var today = new DateOnly(2026, 11, 8);
        Assert.True(IsOverdue(today.AddDays(-1), false, today));
        Assert.False(IsOverdue(today.AddDays(-1), true, today));
        Assert.False(IsOverdue(today, false, today));
        Assert.False(IsOverdue(null, false, today));
        Assert.Equal("WEB-12", TaskCode("WEB", 12));
    }
}
