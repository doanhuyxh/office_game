using OfficeHub.Modules.Assets.Contracts;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Finance.Tests;

public class CashForecastRulesTests
{
    private static readonly DateOnly Monday = new(2026, 11, 23);   // Thứ Hai
    private static readonly DateOnly Sunday = new(2026, 11, 22);   // Chủ nhật

    private static ForecastInput Input(DateOnly today, long opening = 0, int payDay = 10, int delay = 30, long payroll = 0,
        OpenInstallment[]? inst = null, OpenOpportunity[]? opps = null, ServiceRenewal[]? services = null, ForecastExpense[]? expenses = null,
        RecurringItem[]? recurring = null) =>
        new(today, opening, payDay, delay, payroll, inst ?? [], opps ?? [], services ?? [], expenses ?? [], recurring ?? []);

    private static OpenInstallment Inst(DateOnly due, long remaining) =>
        new(Guid.NewGuid(), Guid.NewGuid(), "HD-1", Guid.NewGuid(), "Khách A", "Đợt 1", due, remaining);

    private static OpenOpportunity Opp(DateOnly? close, long weighted) =>
        new(Guid.NewGuid(), Guid.NewGuid(), "Khách B", "Web", "Quoted", close, weighted * 2, 50, weighted);

    private static ServiceRenewal Svc(string cycle, DateOnly renewal, long cost = 100) => new(Guid.NewGuid(), "Figma", null, cycle, cost, renewal);

    private static RecurringItem Rec(CategoryKind kind, int day, long amount, bool active = true) =>
        new() { Name = $"{kind} {day}", Kind = kind, DayOfMonth = day, Amount = amount, IsActive = active };

    // ---------------- Tuần ----------------

    [Fact]
    public void Monday_first_week_is_seven_days_and_window_ends_on_sunday_of_week_13()
    {
        var f = CashForecastRules.Build(Input(Monday));
        Assert.Equal(13, f.Weeks.Count);
        Assert.Equal((Monday, new DateOnly(2026, 11, 29)), (f.Weeks[0].From, f.Weeks[0].To));
        Assert.Equal((new DateOnly(2026, 11, 30), new DateOnly(2026, 12, 6)), (f.Weeks[1].From, f.Weeks[1].To));
        Assert.Equal(new DateOnly(2027, 2, 21), f.To);
        Assert.Equal(f.To, f.Weeks[^1].To);
        Assert.Equal(DayOfWeek.Sunday, f.To.DayOfWeek);
    }

    [Fact]
    public void Sunday_first_week_is_just_today()
    {
        var f = CashForecastRules.Build(Input(Sunday));
        Assert.Equal((Sunday, Sunday), (f.Weeks[0].From, f.Weeks[0].To));
        Assert.Equal((Monday, new DateOnly(2026, 11, 29)), (f.Weeks[1].From, f.Weeks[1].To));
        Assert.Equal(new DateOnly(2027, 2, 14), f.To);
    }

    [Theory]
    [InlineData("2026-11-29", 1)]   // Chủ nhật cuối tuần 1
    [InlineData("2026-11-30", 2)]
    [InlineData("2026-12-06", 2)]
    [InlineData("2026-12-07", 3)]
    [InlineData("2027-02-21", 13)]  // ngày cuối cửa sổ
    public void Week_of_date(string date, int week) => Assert.Equal(week, CashForecastRules.WeekOf(DateOnly.Parse(date), Monday));

    // ---------------- Đợt thu ----------------

    [Fact]
    public void Installment_due_on_week_end_stays_in_that_week_and_outside_window_is_dropped()
    {
        var f = CashForecastRules.Build(Input(Monday, inst: [Inst(new(2026, 11, 29), 100), Inst(new(2027, 2, 21), 7), Inst(new(2027, 2, 22), 999)]));
        Assert.Equal(100, f.Weeks[0].Installments);
        Assert.Equal(7, f.Weeks[12].Installments);
        Assert.Equal(2, f.Items.Count);
        Assert.All(f.Items, i => Assert.Equal(ForecastLine.Installment, i.Line));
    }

    [Fact]
    public void Overdue_goes_to_week_1_expected_only_and_conservative_excludes_overdue_and_pipeline()
    {
        var f = CashForecastRules.Build(Input(Monday, opening: 1000,
            inst: [Inst(new(2026, 12, 1), 100), Inst(new(2026, 10, 1), 50)],
            opps: [Opp(new(2026, 11, 1), 30)]));  // tiền về 01/12 → tuần 2
        var overdue = Assert.Single(f.Items, i => i.Line == ForecastLine.Overdue);
        Assert.Equal((1, true, 50L), (overdue.Week, overdue.Late, overdue.Amount));
        Assert.Equal(50, f.Weeks[0].Overdue);
        Assert.Equal(1000, f.Weeks[0].ClosingConservative);
        Assert.Equal(1050, f.Weeks[0].ClosingExpected);
        Assert.Equal(30, f.Weeks[1].Pipeline);
        Assert.Equal(100, f.Weeks[1].InConservative);
        Assert.Equal(130, f.Weeks[1].InExpected);
        Assert.Equal(1100, f.Weeks[^1].ClosingConservative);
        Assert.Equal(1180, f.Weeks[^1].ClosingExpected);
    }

    // ---------------- Cơ hội ----------------

    [Fact]
    public void Opportunity_uses_close_date_plus_delay_and_falls_outside_window()
    {
        var f = CashForecastRules.Build(Input(Monday, delay: 30, opps: [Opp(new(2027, 1, 30), 40), Opp(new(2026, 10, 1), 20), Opp(new(2026, 11, 1), 10)]));
        Assert.DoesNotContain(f.Items, i => i.Amount == 40);                                    // 30/01 + 30 = 01/03 > 21/02
        var late = Assert.Single(f.Items, i => i.Amount == 20);                                 // 31/10 đã qua → tuần 1
        Assert.Equal((1, true, new DateOnly(2026, 10, 31)), (late.Week, late.Late, late.Date!.Value));
        Assert.Equal(2, Assert.Single(f.Items, i => i.Amount == 10).Week);

        var shorter = CashForecastRules.Build(Input(Monday, delay: 0, opps: [Opp(new(2027, 1, 30), 40)]));
        Assert.Equal(10, Assert.Single(shorter.Items).Week);                                    // đổi số ngày trễ → đổi tuần
    }

    [Fact]
    public void Undated_opportunities_are_counted_not_forecast()
    {
        var f = CashForecastRules.Build(Input(Monday, opps: [Opp(null, 30), Opp(null, 20), Opp(new(2026, 12, 1), 5)]));
        Assert.Equal(2, f.UndatedOpportunities);
        Assert.Equal(100, f.UndatedValue);
        Assert.Equal(50, f.UndatedWeighted);
        Assert.Single(f.Items);
    }

    // ---------------- Lương ----------------

    [Fact]
    public void Payroll_falls_three_times_on_day_10()
    {
        var f = CashForecastRules.Build(Input(Monday, payroll: 300));
        var pays = f.Items.Where(i => i.Line == ForecastLine.Payroll).ToList();
        Assert.Equal([new(2026, 12, 10), new(2027, 1, 10), new(2027, 2, 10)], pays.Select(p => p.Date!.Value));
        Assert.Equal("Lương tháng 11/2026", pays[0].Name);
        Assert.All(pays, p => Assert.Equal(300, p.Amount));
    }

    [Fact]
    public void Payroll_falls_four_times_when_window_spans_four_paydays()
    {
        var feb1 = new DateOnly(2027, 2, 1);   // Thứ Hai → cửa sổ tới 02/05
        Assert.Equal([new(2027, 2, 2), new(2027, 3, 2), new(2027, 4, 2), new(2027, 5, 2)],
            CashForecastRules.PayDates(feb1, 2).Select(p => p.PayOn));
    }

    [Fact]
    public void Payroll_zero_cost_adds_nothing()
    {
        var f = CashForecastRules.Build(Input(Monday, payroll: 0));
        Assert.Empty(f.Items);
        Assert.All(f.Weeks, w => Assert.Equal(0, w.Payroll));
    }

    [Fact]
    public void Payday_equal_to_today_is_treated_as_paid()
    {
        var dates = CashForecastRules.PayDates(Monday, 23).Select(p => p.PayOn).ToList();
        Assert.Equal([new(2026, 12, 23), new(2027, 1, 23)], dates);   // 23/11 = hôm nay không tính, 23/02 ngoài cửa sổ
    }

    [Fact]
    public void Day_missing_in_month_uses_last_day() => Assert.Equal(new DateOnly(2027, 2, 28), CashForecastRules.DayIn(new(2027, 2, 1), 31));

    // ---------------- Gia hạn dịch vụ ----------------

    [Fact]
    public void Monthly_service_repeats_and_yearly_once_inside_window()
    {
        var f = CashForecastRules.Build(Input(Monday, services: [Svc("Monthly", new(2026, 12, 5)), Svc("Yearly", new(2027, 1, 15), 1200), Svc("Yearly", new(2027, 6, 1))]));
        var r = f.Items.Where(i => i.Line == ForecastLine.Renewal).ToList();
        Assert.Equal([new(2026, 12, 5), new(2027, 1, 5), new(2027, 1, 15), new(2027, 2, 5)], r.Select(i => i.Date!.Value).Order());
        Assert.All(r, i => Assert.False(i.Late));
    }

    [Fact]
    public void Overdue_renewal_goes_to_week_1_flagged_then_continues_by_cycle()
    {
        var f = CashForecastRules.Build(Input(Monday, services: [Svc("Monthly", new(2026, 10, 5)), Svc("Yearly", new(2026, 3, 1), 500)]));
        var late = f.Items.Where(i => i.Late).ToList();
        Assert.Equal(2, late.Count);
        Assert.All(late, i => Assert.Equal(1, i.Week));
        Assert.Equal(600, f.Weeks[0].Renewals);
        Assert.Equal([new(2026, 12, 5), new(2027, 1, 5), new(2027, 2, 5)], f.Items.Where(i => !i.Late).Select(i => i.Date!.Value));
    }

    // ---------------- Đề nghị chi + khoản định kỳ ----------------

    [Fact]
    public void Approved_expenses_by_needed_by_empty_or_past_go_to_week_1()
    {
        var f = CashForecastRules.Build(Input(Monday, expenses: [
            new(Guid.NewGuid(), "CP-00001", "Không ngày", null, 10),
            new(Guid.NewGuid(), "CP-00002", "Quá ngày", new(2026, 11, 1), 20),
            new(Guid.NewGuid(), "CP-00003", "Giữa tháng 12", new(2026, 12, 15), 40),
            new(Guid.NewGuid(), "CP-00004", "Ngoài cửa sổ", new(2027, 6, 1), 80)]));
        Assert.Equal(30, f.Weeks[0].Expenses);
        Assert.Equal(40, f.Weeks[3].Expenses);
        Assert.Equal(3, f.Items.Count);
        Assert.Equal("CP-00003", f.Items.Single(i => i.Amount == 40).RefCode);
        Assert.True(f.Items.Single(i => i.Amount == 20).Late);
        Assert.False(f.Items.Single(i => i.Amount == 10).Late);
    }

    [Fact]
    public void Recurring_items_repeat_monthly_and_stopped_items_are_ignored()
    {
        var f = CashForecastRules.Build(Input(Monday, recurring: [Rec(CategoryKind.Income, 25, 7), Rec(CategoryKind.Expense, 23, 5), Rec(CategoryKind.Expense, 1, 999, active: false)]));
        Assert.Equal([new(2026, 11, 25), new(2026, 12, 25), new(2027, 1, 25)],
            f.Items.Where(i => i.Line == ForecastLine.RecurringIncome).Select(i => i.Date!.Value));
        Assert.Equal([new(2026, 12, 23), new(2027, 1, 23)],                    // 23/11 = hôm nay coi như đã chi
            f.Items.Where(i => i.Line == ForecastLine.RecurringExpense).Select(i => i.Date!.Value));
        Assert.DoesNotContain(f.Items, i => i.Amount == 999);
        Assert.Equal(7, f.Weeks[0].InConservative);
        Assert.Equal(21 - 10, f.Weeks[^1].ClosingConservative);
    }

    // ---------------- Tuần âm đầu tiên ----------------

    [Fact]
    public void First_negative_week_per_path()
    {
        var f = CashForecastRules.Build(Input(Monday, opening: 100, payroll: 300, inst: [Inst(new(2026, 10, 1), 500)]));
        Assert.Equal(3, f.FirstNegativeConservative);   // lương 10/12 (tuần 3): 100 − 300
        Assert.Equal(12, f.FirstNegativeExpected);      // 100 + 500 − 3 × 300 → âm ở kỳ 10/02 (tuần 12)
        Assert.Equal(0, f.Weeks[6].ClosingExpected);    // 0 chưa phải âm

        var fine = CashForecastRules.Build(Input(Monday, opening: 10_000, payroll: 300));
        Assert.Null(fine.FirstNegativeConservative);
        Assert.Null(fine.FirstNegativeExpected);
    }
}
