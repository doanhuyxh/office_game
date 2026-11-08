using static OfficeHub.Modules.Projects.Domain.ProjectCostRules;
using static OfficeHub.Modules.Projects.Domain.EffortRules;

namespace OfficeHub.Modules.Projects.Tests;

public class ProjectCostRulesTests
{
    [Fact]
    public void Labor_cost_is_month_cost_times_allocation()
    {
        Assert.Equal(15_000_000, LaborCost(30_000_000, 20, 50));
        Assert.Equal(10_000_000, LaborCost(30_000_000, 5, 33.333333m)); // làm tròn tới đồng
        Assert.Equal(30_000_000, LaborCost(30_000_000, 21, 100));
    }

    [Fact]
    public void Labor_cost_is_zero_without_attendance_or_allocation()
    {
        Assert.Equal(0, LaborCost(30_000_000, 0, 100));   // nghỉ cả tháng → vào chi phí chung, không vào dự án
        Assert.Equal(0, LaborCost(30_000_000, 20, 0));    // đặt 0 %
        Assert.Equal(0, LaborCost(0, 20, 100));           // chưa có hợp đồng / lương
    }

    [Fact]
    public void Labor_cost_never_exceeds_month_cost() => Assert.Equal(30_000_000, LaborCost(30_000_000, 20, 150));

    [Fact]
    public void Revenue_is_value_after_tax_and_vat_is_a_cost()
    {
        // 100tr trước thuế, VAT 10% → doanh thu 110tr, VAT 10tr (chủ dự án chốt: thuế tính vào chi phí)
        Assert.Equal((110_000_000L, 10_000_000L), ContractRevenue("Active", 100_000_000, 110_000_000, 0));
        Assert.Equal((110_000_000L, 10_000_000L), ContractRevenue("Completed", 100_000_000, 110_000_000, 110_000_000));
    }

    [Fact]
    public void Cancelled_contract_counts_only_collected_with_proportional_vat()
    {
        Assert.Equal((55_000_000L, 5_000_000L), ContractRevenue("Cancelled", 100_000_000, 110_000_000, 55_000_000));
        Assert.Equal((0L, 0L), ContractRevenue("Cancelled", 100_000_000, 110_000_000, 0));
        Assert.Equal(0, Outstanding("Cancelled", 110_000_000, 55_000_000));
        Assert.Equal(55_000_000, Outstanding("Active", 110_000_000, 55_000_000));
        Assert.Equal(0, Outstanding("Active", 110_000_000, 120_000_000)); // thu dư không âm
    }

    [Fact]
    public void Profit_subtracts_vat_labor_and_direct_cost_and_adds_other_income()
    {
        var profit = Profit(revenue: 110_000_000, vat: 10_000_000, otherIncome: 2_000_000, labor: 60_000_000, directExpense: 12_000_000);
        Assert.Equal(30_000_000, profit);
        Assert.Equal(26.8m, MarginPercent(profit, 110_000_000, 2_000_000)); // 30 / 112
    }

    [Fact]
    public void Internal_project_has_no_margin_and_shows_loss()
    {
        var profit = Profit(0, 0, 0, 40_000_000, 1_000_000);
        Assert.Equal(-41_000_000, profit);
        Assert.Null(MarginPercent(profit, 0, 0));
    }

    [Fact]
    public void Freezes_previous_month()
    {
        Assert.Equal(new DateOnly(2026, 10, 1), MonthToFreeze(new DateOnly(2026, 11, 1)));
        Assert.Equal(new DateOnly(2025, 12, 1), MonthToFreeze(new DateOnly(2026, 1, 31)));
    }

    [Fact]
    public void Total_check_accepts_fractional_defaults()
    {
        Assert.Null(CheckTotal(33.33m, 66.66m));
        Assert.NotNull(CheckTotal(50, 50.01m));
    }
}
