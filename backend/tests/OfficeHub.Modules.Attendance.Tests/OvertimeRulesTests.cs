using OfficeHub.Modules.Attendance.Domain;

namespace OfficeHub.Modules.Attendance.Tests;

public class OvertimeRulesTests
{
    private static readonly TimeZoneInfo Tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
    private static readonly DateOnly Day = new(2026, 11, 4); // thứ 4
    private static readonly DateTimeOffset NextDay = TimesheetCalculator.At(Day.AddDays(1), new TimeOnly(9, 0), Tz);

    private static readonly Shift Fixed = new()
    {
        Name = "Hành chính", Type = ShiftType.Fixed, StartTime = new(8, 30), EndTime = new(17, 30),
        BreakStart = new(12, 0), BreakEnd = new(13, 30),
    };

    private static readonly Shift Flex = new() { Name = "Linh hoạt", Type = ShiftType.Flexible, RequiredMinutes = 480 };

    [Theory]
    [InlineData(false, true, OvertimeKind.Weekday, 150)]
    [InlineData(false, false, OvertimeKind.RestDay, 200)]
    [InlineData(true, true, OvertimeKind.Holiday, 300)]
    [InlineData(true, false, OvertimeKind.Holiday, 300)]
    public void Classify_by_day_type(bool holiday, bool hasShift, OvertimeKind kind, int percent)
    {
        Assert.Equal(kind, OvertimeRules.Classify(holiday, hasShift));
        Assert.Equal(percent, OvertimeRules.Percent(kind));
    }

    [Fact]
    public void Minutes_same_day_only()
    {
        Assert.Equal(150, OvertimeRules.MinutesOf(new(18, 0), new(20, 30)));
        Assert.Equal(0, OvertimeRules.MinutesOf(new(22, 0), new(1, 0))); // qua đêm: chưa hỗ trợ
        Assert.Equal(0, OvertimeRules.MinutesOf(new(18, 0), new(18, 0)));
    }

    [Fact]
    public void Fixed_shift_hours_cannot_be_overtime()
    {
        Assert.Equal((new TimeOnly(8, 30), new TimeOnly(17, 30)), OvertimeRules.ShiftOverlap(Fixed, new(17, 0), new(19, 0)));
        Assert.NotNull(OvertimeRules.ShiftOverlap(Fixed, new(12, 0), new(13, 0))); // nghỉ trưa vẫn trong khung ca
        Assert.Null(OvertimeRules.ShiftOverlap(Fixed, new(17, 30), new(19, 0)));  // sát giờ ra: hợp lệ
        Assert.Null(OvertimeRules.ShiftOverlap(Fixed, new(6, 0), new(8, 30)));
        Assert.Null(OvertimeRules.ShiftOverlap(Flex, new(9, 0), new(11, 0)));     // ca linh hoạt: không kiểm tra
        Assert.Null(OvertimeRules.ShiftOverlap(null, new(9, 0), new(11, 0)));     // ngày nghỉ
    }

    [Fact]
    public void Overlap_between_requests()
    {
        Assert.True(OvertimeRules.Overlaps(new(18, 0), new(20, 0), new(19, 0), new(21, 0)));
        Assert.False(OvertimeRules.Overlaps(new(18, 0), new(20, 0), new(20, 0), new(21, 0)));
    }

    [Fact]
    public void Warnings_when_exceeding_monthly_or_yearly_limit()
    {
        Assert.Empty(OvertimeRules.Warnings(Day, 38 * 60, 100 * 60, 120)); // đúng 40 giờ: chưa vượt
        var month = Assert.Single(OvertimeRules.Warnings(Day, 39 * 60, 100 * 60, 90));
        Assert.Contains("40,5 giờ", month);
        Assert.Contains("40 giờ/tháng", month);
        Assert.Equal(2, OvertimeRules.Warnings(Day, 39 * 60, 199 * 60, 120).Count);
    }

    [Fact]
    public void Timesheet_adds_approved_overtime_with_kind()
    {
        var weekday = TimesheetCalculator.Compute(Day, [], Fixed, false, NextDay, Tz, overtimeMinutes: 120);
        Assert.Equal(120, weekday.OvertimeMinutes);
        Assert.Equal(OvertimeKind.Weekday, weekday.OvertimeKind);
        Assert.Equal(DayStatus.Absent, weekday.Status); // tính theo đơn được duyệt, không phụ thuộc chấm công

        var restDay = TimesheetCalculator.Compute(Day, [], null, false, NextDay, Tz, overtimeMinutes: 240);
        Assert.Equal(OvertimeKind.RestDay, restDay.OvertimeKind);
        Assert.Equal(DayStatus.DayOff, restDay.Status);

        Assert.Equal(OvertimeKind.Holiday, TimesheetCalculator.Compute(Day, [], Fixed, true, NextDay, Tz, overtimeMinutes: 60).OvertimeKind);

        var none = TimesheetCalculator.Compute(Day, [], Fixed, false, NextDay, Tz);
        Assert.Equal(0, none.OvertimeMinutes);
        Assert.Null(none.OvertimeKind);
    }
}
