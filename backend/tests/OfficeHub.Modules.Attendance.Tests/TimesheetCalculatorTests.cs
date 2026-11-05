using OfficeHub.Modules.Attendance.Domain;

namespace OfficeHub.Modules.Attendance.Tests;

public class TimesheetCalculatorTests
{
    private static readonly TimeZoneInfo Tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
    private static readonly DateOnly Day = new(2026, 11, 4); // thứ 4

    /// <summary>Ca hành chính 08:30–17:30, nghỉ 12:00–13:30, trễ cho phép 5 phút → phải làm 7h30 = 450 phút.</summary>
    private static readonly Shift Fixed = new()
    {
        Name = "Hành chính", Type = ShiftType.Fixed,
        StartTime = new(8, 30), EndTime = new(17, 30), GraceMinutes = 5,
        BreakStart = new(12, 0), BreakEnd = new(13, 30),
    };

    /// <summary>Linh hoạt: đủ 8h, vào 07:00–10:00, nghỉ trưa 12:00–13:00.</summary>
    private static readonly Shift Flex = new()
    {
        Name = "Linh hoạt", Type = ShiftType.Flexible, RequiredMinutes = 480,
        EarliestIn = new(7, 0), LatestIn = new(10, 0), BreakStart = new(12, 0), BreakEnd = new(13, 0),
    };

    private static DateTimeOffset T(int h, int m, DateOnly? d = null) => TimesheetCalculator.At(d ?? Day, new TimeOnly(h, m), Tz);
    private static Punch In(int h, int m, WorkMode mode = WorkMode.Onsite) => new(T(h, m), PunchType.In, mode);
    private static Punch Out(int h, int m, WorkMode mode = WorkMode.Onsite) => new(T(h, m), PunchType.Out, mode);
    private static readonly DateTimeOffset NextDay = T(9, 0, Day.AddDays(1));

    private static DayResult Calc(Shift? shift, params Punch[] p) => TimesheetCalculator.Compute(Day, p, shift, false, NextDay, Tz);

    [Fact]
    public void Fixed_on_time_full_day()
    {
        var r = Calc(Fixed, In(8, 25), Out(17, 35));
        Assert.Equal(DayStatus.Present, r.Status);
        Assert.Equal(450, r.RequiredMinutes);
        Assert.Equal(9 * 60 + 10 - 90, r.WorkedMinutes); // 08:25→17:35 trừ 90 phút nghỉ trưa
        Assert.Equal(0, r.LateMinutes);
        Assert.Equal(0, r.ShortMinutes);
        Assert.Equal("Onsite", r.WorkMode);
    }

    [Fact]
    public void Fixed_late_within_grace_is_not_late()
    {
        Assert.Equal(0, Calc(Fixed, In(8, 35), Out(17, 30)).LateMinutes);
    }

    [Fact]
    public void Fixed_late_beyond_grace_counts_from_start()
    {
        Assert.Equal(12, Calc(Fixed, In(8, 42), Out(17, 30)).LateMinutes);
    }

    [Fact]
    public void Fixed_leave_early()
    {
        var r = Calc(Fixed, In(8, 30), Out(16, 50));
        Assert.Equal(40, r.ShortMinutes);
    }

    [Fact]
    public void Multiple_sessions_and_mixed_mode()
    {
        // Sáng ở văn phòng, chiều về nhà làm tiếp
        var r = Calc(Fixed, In(8, 30), Out(11, 30), In(14, 0, WorkMode.Remote), Out(17, 30, WorkMode.Remote));
        Assert.Equal(DayStatus.Present, r.Status);
        Assert.Equal(180 + 210, r.WorkedMinutes);
        Assert.Equal("Mixed", r.WorkMode);
        Assert.Equal(2, r.Sessions.Count);
    }

    [Fact]
    public void Duplicate_in_and_stray_out_are_ignored()
    {
        var r = Calc(Fixed, Out(8, 0), In(8, 30), In(8, 31), Out(12, 0));
        Assert.Single(r.Sessions);
        Assert.Equal(210, r.WorkedMinutes);
    }

    [Fact]
    public void Past_day_without_checkout_is_missing_checkout_and_not_counted()
    {
        var r = Calc(Fixed, In(8, 30));
        Assert.Equal(DayStatus.MissingCheckout, r.Status);
        Assert.Equal(0, r.WorkedMinutes);
    }

    [Fact]
    public void Today_open_session_counts_until_now()
    {
        var now = T(10, 30);
        var r = TimesheetCalculator.Compute(Day, [In(8, 30)], Fixed, false, now, Tz);
        Assert.Equal(DayStatus.Working, r.Status);
        Assert.Equal(120, r.WorkedMinutes);
    }

    [Fact]
    public void No_punch_statuses()
    {
        Assert.Equal(DayStatus.Absent, Calc(Fixed).Status);
        Assert.Equal(DayStatus.DayOff, Calc(null).Status);
        Assert.Equal(DayStatus.Holiday, TimesheetCalculator.Compute(Day, [], Fixed, true, NextDay, Tz).Status);
        Assert.Equal(DayStatus.NotYet, TimesheetCalculator.Compute(Day, [], Fixed, false, T(8, 0), Tz).Status);
        Assert.Equal(DayStatus.Absent, TimesheetCalculator.Compute(Day, [], Fixed, false, T(18, 0), Tz).Status);
    }

    [Fact]
    public void Flexible_short_hours_and_late_after_latest_in()
    {
        var r = Calc(Flex, In(10, 20), Out(18, 0)); // 7h40 - 60 nghỉ = 400 phút
        Assert.Equal(400, r.WorkedMinutes);
        Assert.Equal(20, r.LateMinutes);
        Assert.Equal(80, r.ShortMinutes);
    }

    [Fact]
    public void Flexible_enough_hours()
    {
        var r = Calc(Flex, In(7, 30), Out(16, 30));
        Assert.Equal(480, r.WorkedMinutes);
        Assert.Equal(0, r.ShortMinutes);
        Assert.Equal(0, r.LateMinutes);
    }

    [Fact]
    public void Working_on_day_off_is_still_recorded()
    {
        var r = Calc(null, In(9, 0), Out(11, 0));
        Assert.Equal(DayStatus.Present, r.Status);
        Assert.Equal(120, r.WorkedMinutes);
        Assert.Equal(0, r.RequiredMinutes);
    }
}
