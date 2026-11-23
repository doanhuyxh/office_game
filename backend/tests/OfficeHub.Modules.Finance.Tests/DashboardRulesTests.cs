using OfficeHub.Modules.Finance.Domain;

namespace OfficeHub.Modules.Finance.Tests;

public class DashboardRulesTests
{
    private static readonly DateOnly ThisMonth = new(2026, 11, 1);
    private static readonly Guid Web = Guid.NewGuid(), Social = Guid.NewGuid();

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(12, true)]
    [InlineData(24, true)]
    [InlineData(25, false)]
    public void Months_must_be_between_1_and_24(int months, bool ok) => Assert.Equal(ok, DashboardRules.ValidMonths(months));

    [Fact]
    public void First_month_counts_the_current_month()
    {
        Assert.Equal(new DateOnly(2025, 12, 1), DashboardRules.FirstMonth(ThisMonth, 12));
        Assert.Equal(ThisMonth, DashboardRules.FirstMonth(ThisMonth, 1));
    }

    [Fact]
    public void Empty_months_still_produce_zero_rows_in_order()
    {
        var m = DashboardRules.Monthly(ThisMonth, 12, []);
        Assert.Equal(12, m.Count);
        Assert.Equal(new DateOnly(2025, 12, 1), m[0].Month);
        Assert.Equal(ThisMonth, m[^1].Month);
        Assert.All(m, x => { Assert.Equal(0, x.Income); Assert.Equal(0, x.Expense); Assert.Equal(0, x.Profit); Assert.Empty(x.ByLine); });
    }

    [Fact]
    public void Groups_by_month_and_line_and_skips_transfers_and_out_of_range()
    {
        var m = DashboardRules.Monthly(ThisMonth, 3, [
            (new DateOnly(2026, 11, 3), TxKind.Income, Web, 100),
            (new DateOnly(2026, 11, 20), TxKind.Income, Web, 50),
            (new DateOnly(2026, 11, 5), TxKind.Expense, null, 30),
            (new DateOnly(2026, 11, 6), TxKind.Transfer, null, 999),       // chuyển quỹ không tính
            (new DateOnly(2026, 10, 31), TxKind.Expense, Social, 40),
            (new DateOnly(2026, 9, 1), TxKind.Income, Social, 7),
            (new DateOnly(2026, 8, 31), TxKind.Income, Web, 1000),          // trước khoảng
            (new DateOnly(2026, 12, 1), TxKind.Income, Web, 1000),          // sau khoảng
        ]);
        Assert.Equal([new DateOnly(2026, 9, 1), new DateOnly(2026, 10, 1), ThisMonth], m.Select(x => x.Month));
        var nov = m[2];
        Assert.Equal((150, 30, 120), (nov.Income, nov.Expense, nov.Profit));
        Assert.Equal(2, nov.ByLine.Count);
        Assert.Equal(Web, nov.ByLine[0].BusinessLineId); // nhiều tiền trước
        Assert.Equal((150, 0), (nov.ByLine[0].Income, nov.ByLine[0].Expense));
        Assert.Null(nov.ByLine[1].BusinessLineId);
        Assert.Equal((0, 40, -40), (m[1].Income, m[1].Expense, m[1].Profit));
        Assert.Equal(7, m[0].Income);

        var total = DashboardRules.TotalByLine(m);
        Assert.Equal(3, total.Count);
        Assert.Equal((150L, 0L), (total.Single(x => x.BusinessLineId == Web).Income, total.Single(x => x.BusinessLineId == Web).Expense));
        Assert.Equal((7L, 40L), (total.Single(x => x.BusinessLineId == Social).Income, total.Single(x => x.BusinessLineId == Social).Expense));
    }
}
