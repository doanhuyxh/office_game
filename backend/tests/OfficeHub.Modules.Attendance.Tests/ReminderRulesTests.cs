using OfficeHub.Modules.Attendance.Domain;

namespace OfficeHub.Modules.Attendance.Tests;

public class ReminderRulesTests
{
    private static readonly ReminderSettings S = new();
    private static readonly Shift Fixed = new() { Name = "HC", Type = ShiftType.Fixed, StartTime = new(8, 30), EndTime = new(17, 30) };
    private static readonly Shift Flexible = new() { Name = "Linh hoạt", Type = ShiftType.Flexible, RequiredMinutes = 480 };

    [Fact]
    public void Fixed_shift_reminds_after_end_plus_grace()
    {
        Assert.Equal(new TimeOnly(18, 0), ReminderRules.CheckoutDueAt(Fixed, S));
        Assert.False(ReminderRules.CheckoutDue(PunchType.In, new(17, 59), Fixed, S));
        Assert.True(ReminderRules.CheckoutDue(PunchType.In, new(18, 0), Fixed, S));
    }

    [Fact]
    public void Already_checked_out_or_never_in_is_not_reminded()
    {
        Assert.False(ReminderRules.CheckoutDue(PunchType.Out, new(22, 0), Fixed, S));
        Assert.False(ReminderRules.CheckoutDue(null, new(22, 0), Fixed, S));
    }

    [Fact]
    public void Flexible_or_no_shift_reminds_at_configured_hour()
    {
        Assert.Equal(new TimeOnly(21, 0), ReminderRules.CheckoutDueAt(Flexible, S));
        Assert.Equal(new TimeOnly(21, 0), ReminderRules.CheckoutDueAt(null, S));
        Assert.True(ReminderRules.CheckoutDue(PunchType.In, new(21, 5), null, S));
    }

    [Fact]
    public void Late_shift_due_time_caps_before_midnight()
    {
        var late = new Shift { Name = "Tối", Type = ShiftType.Fixed, StartTime = new(15, 0), EndTime = new(23, 45) };
        Assert.Equal(new TimeOnly(23, 59), ReminderRules.CheckoutDueAt(late, S));
    }

    [Fact]
    public void Next_morning_reminder_needs_open_session_and_no_correction()
    {
        Assert.True(ReminderRules.MissingCheckoutDue(PunchType.In, false, new(8, 0), S));
        Assert.False(ReminderRules.MissingCheckoutDue(PunchType.In, false, new(7, 59), S));
        Assert.False(ReminderRules.MissingCheckoutDue(PunchType.In, true, new(9, 0), S));   // đã gửi giải trình
        Assert.False(ReminderRules.MissingCheckoutDue(PunchType.Out, false, new(9, 0), S));
    }
}
