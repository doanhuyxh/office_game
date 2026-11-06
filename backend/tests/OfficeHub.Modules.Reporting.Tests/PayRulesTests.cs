using OfficeHub.Modules.Attendance.Contracts;
using OfficeHub.Modules.Reporting.Domain;
using OfficeHub.Modules.Reporting.Infrastructure;

namespace OfficeHub.Modules.Reporting.Tests;

public class PayRulesTests
{
    [Fact]
    public void Hourly_wage_is_salary_over_standard_days_over_8()
    {
        // 22.000.000 ÷ 22 ngày ÷ 8 = 125.000 đ/giờ
        Assert.Equal(1_000_000m, PayRules.DailyWage(22_000_000m, 22));
        Assert.Equal(125_000m, PayRules.HourlyWage(22_000_000m, 22));
        // Tháng 26 ngày công chuẩn (làm cả thứ 7) → lương giờ thấp hơn
        Assert.Equal(105_769m, PayRules.RoundVnd(PayRules.HourlyWage(22_000_000m, 26)!.Value));
    }

    [Fact]
    public void Missing_salary_or_no_shift_gives_null_not_zero()
    {
        Assert.Null(PayRules.HourlyWage(null, 22));
        Assert.Null(PayRules.HourlyWage(10_000_000m, 0));
        Assert.Null(PayRules.OvertimeAmount(60, null, 150));
        Assert.Null(PayRules.LeavePayout(3, null));
    }

    [Theory]
    [InlineData(120, 150, 375_000)]   // 2 giờ ngày thường
    [InlineData(90, 200, 375_000)]    // 1,5 giờ ngày nghỉ tuần
    [InlineData(60, 300, 375_000)]    // 1 giờ ngày lễ
    [InlineData(25, 150, 78_125)]     // 25 phút
    public void Overtime_amount_uses_percent(int minutes, int percent, decimal expected) =>
        Assert.Equal(expected, PayRules.OvertimeAmount(minutes, 125_000m, percent));

    [Fact]
    public void Leave_payout_is_remaining_days_times_daily_wage_and_never_negative()
    {
        Assert.Equal(4_500_000m, PayRules.LeavePayout(4.5m, 1_000_000m));
        Assert.Equal(0m, PayRules.LeavePayout(-2m, 1_000_000m));
        Assert.Equal(333_333m, PayRules.LeavePayout(0.5m, 666_666.666m));
    }

    private static TimesheetDay Day(string status, int worked = 0, decimal leave = 0) =>
        new(new DateOnly(2026, 11, 2), status, worked, 480, 0, 0, leave, null, null, 0, null, null, null);

    [Theory]
    [InlineData("Present", 480, 0, "8")]
    [InlineData("Present", 270, 0.5, "4.5+½P")]
    [InlineData("Leave", 0, 1, "P")]
    [InlineData("Absent", 0, 0, "V")]
    [InlineData("Absent", 0, 0.5, "½P")]
    [InlineData("Holiday", 0, 0, "L")]
    [InlineData("MissingCheckout", 200, 0, "Q")]
    [InlineData("NotEmployed", 0, 0, "–")]
    [InlineData("DayOff", 0, 0, "")]
    [InlineData("DayOff", 180, 0, "3")]
    public void Timesheet_grid_codes(string status, int worked, decimal leave, string expected) =>
        Assert.Equal(expected, ExcelExport.DayCode(Day(status, worked, leave)));
}
