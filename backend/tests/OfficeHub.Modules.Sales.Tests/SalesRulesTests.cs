using OfficeHub.Modules.Sales.Domain;
using static OfficeHub.Modules.Sales.Domain.SalesRules;

namespace OfficeHub.Modules.Sales.Tests;

public class SalesRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 11); // thứ Tư

    [Theory]
    [InlineData(ContractStatus.Active, ContractStatus.Completed, true)]
    [InlineData(ContractStatus.Active, ContractStatus.Cancelled, true)]
    [InlineData(ContractStatus.Completed, ContractStatus.Active, true)]       // mở lại khi đóng nhầm
    [InlineData(ContractStatus.Cancelled, ContractStatus.Active, false)]      // TEST-21: huỷ là trạng thái cuối
    [InlineData(ContractStatus.Cancelled, ContractStatus.Completed, false)]
    [InlineData(ContractStatus.Completed, ContractStatus.Cancelled, false)]
    [InlineData(ContractStatus.Cancelled, ContractStatus.Cancelled, true)]    // giữ nguyên (sửa tên / ghi chú)
    public void Contract_status_machine(ContractStatus from, ContractStatus to, bool ok) => Assert.Equal(ok, CanChangeStatus(from, to));

    [Fact]
    public void Total_adds_vat_rounded()
    {
        Assert.Equal(110_000_000, Total(100_000_000, 10));
        Assert.Equal(108, Total(100, 8));
        Assert.Equal(16, Total(15, 5)); // 0,75 → làm tròn lên
        Assert.Equal(100, Total(100, 0));
    }

    [Theory]
    [InlineData(false, 100, 0, 5, InstallmentState.DueSoon)]     // còn 5 ngày
    [InlineData(false, 100, 0, 8, InstallmentState.Upcoming)]    // còn 8 ngày
    [InlineData(false, 100, 0, 0, InstallmentState.DueSoon)]     // đúng hạn hôm nay
    [InlineData(false, 100, 0, -1, InstallmentState.Overdue)]
    [InlineData(false, 100, 40, 3, InstallmentState.Partial)]
    [InlineData(false, 100, 40, -3, InstallmentState.Overdue)]   // trả một phần nhưng đã quá hạn → vẫn quá hạn
    [InlineData(false, 100, 100, -30, InstallmentState.Paid)]
    [InlineData(false, 100, 120, 3, InstallmentState.Paid)]
    [InlineData(true, 100, 0, -30, InstallmentState.Cancelled)]
    public void Installment_status(bool cancelled, long amount, long collected, int dueInDays, InstallmentState expected) =>
        Assert.Equal(expected, InstallmentStatus(cancelled, amount, collected, Today.AddDays(dueInDays), Today));

    [Theory]
    [InlineData(0, null)]
    [InlineData(-5, null)]
    [InlineData(1, "1-30")]
    [InlineData(30, "1-30")]
    [InlineData(31, "31-60")]
    [InlineData(61, "61-90")]
    [InlineData(91, ">90")]
    public void Aging_buckets(int daysOverdue, string? bucket) => Assert.Equal(bucket, AgingBucket(Today.AddDays(-daysOverdue), Today));

    [Fact]
    public void Monthly_schedule_clamps_to_month_end()
    {
        var s = MonthlySchedule(new DateOnly(2026, 1, 31), 3, 5_000_000);
        Assert.Equal([new DateOnly(2026, 1, 31), new DateOnly(2026, 2, 28), new DateOnly(2026, 3, 31)], s.Select(x => x.DueOn));
        Assert.Equal("Tháng 02/2026", s[1].Title);
        Assert.All(s, x => Assert.Equal(5_000_000, x.Amount));
    }

    [Fact]
    public void Schedule_sum_must_equal_total_for_milestones_but_may_be_less_for_monthly()
    {
        var signed = new DateOnly(2026, 1, 1);
        (string, DateOnly, long)[] two = [("Đợt 1", signed, 60), ("Đợt 2", signed.AddDays(30), 40)];
        Assert.Empty(ValidateSchedule(BillingKind.Milestone, 100, signed, two));
        Assert.NotEmpty(ValidateSchedule(BillingKind.Milestone, 110, signed, two));
        Assert.Empty(ValidateSchedule(BillingKind.Monthly, 1_000, signed, two));
        Assert.NotEmpty(ValidateSchedule(BillingKind.Monthly, 50, signed, two));
        Assert.NotEmpty(ValidateSchedule(BillingKind.OneTime, 100, signed, two));                       // một lần → 1 đợt
        Assert.NotEmpty(ValidateSchedule(BillingKind.Milestone, 100, signed, [("", signed, 100)]));    // thiếu tên
        Assert.NotEmpty(ValidateSchedule(BillingKind.Milestone, 100, signed, [("x", signed.AddDays(-1), 100)])); // hạn trước ngày ký
        Assert.NotEmpty(ValidateSchedule(BillingKind.Milestone, 0, signed, []));
    }

    [Fact]
    public void Weighted_pipeline_ignores_closed()
    {
        Assert.Equal(40, Weighted(100, 40, OpportunityStage.Quoted));
        Assert.Equal(0, Weighted(100, 100, OpportunityStage.Won));
        Assert.Equal(100, DefaultProbability(OpportunityStage.Won));
        Assert.Equal(0, DefaultProbability(OpportunityStage.Lost));
    }

    [Fact]
    public void Reminders_fire_once_except_weekly_overdue()
    {
        var soon = Today.AddDays(7);
        Assert.Equal(Reminder.DueSoon, ReminderFor(InstallmentState.DueSoon, soon, Today, false, false, null));
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.DueSoon, soon, Today, true, false, null));
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.Upcoming, Today.AddDays(8), Today, false, false, null));
        Assert.Equal(Reminder.DueToday, ReminderFor(InstallmentState.DueSoon, Today, Today, true, false, null));
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.DueSoon, Today, Today, true, true, null));
        var past = Today.AddDays(-3);
        Assert.Equal(Reminder.Overdue, ReminderFor(InstallmentState.Overdue, past, Today, true, true, null));          // lần đầu phát hiện
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.Overdue, past, Today, true, true, Today.AddDays(-1))); // không phải thứ Hai
        var monday = new DateOnly(2026, 11, 16);
        Assert.Equal(Reminder.Overdue, ReminderFor(InstallmentState.Overdue, past, monday, true, true, Today));
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.Overdue, past, monday, true, true, monday));          // đã nhắc hôm nay
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.Paid, past, monday, true, true, null));
        Assert.Equal(Reminder.None, ReminderFor(InstallmentState.Cancelled, past, monday, true, true, null));
    }
}
