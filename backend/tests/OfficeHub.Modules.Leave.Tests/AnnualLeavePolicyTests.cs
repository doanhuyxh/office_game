using OfficeHub.Modules.Leave.Domain;

namespace OfficeHub.Modules.Leave.Tests;

public class AnnualLeavePolicyTests
{
    [Fact]
    public void Base_entitlement_is_12_days()
    {
        Assert.Equal(12, AnnualLeavePolicy.EntitlementForYear(2026, new DateOnly(2024, 3, 1)));
    }

    [Theory]
    [InlineData("2021-01-01", 2026, 13)] // tròn 5 năm tại 1/1/2026
    [InlineData("2021-01-02", 2026, 12)] // chưa tròn 5 năm tại 1/1/2026
    [InlineData("2016-01-01", 2026, 14)] // 10 năm
    public void Seniority_adds_one_day_per_five_years(string joined, int year, int expected)
    {
        Assert.Equal(expected, AnnualLeavePolicy.EntitlementForYear(year, DateOnly.Parse(joined)));
    }

    [Fact]
    public void Accrues_one_twelfth_per_month_including_current_month()
    {
        // Vào làm từ năm trước, tới tháng 11 → 11/12 × 12 = 11 ngày
        Assert.Equal(11m, AnnualLeavePolicy.AccruedInYear(2026, new DateOnly(2024, 6, 1), null, new DateOnly(2026, 11, 5)));
    }

    [Fact]
    public void First_year_counts_from_join_month()
    {
        // Vào 15/09/2026, tới 05/11/2026 → tháng 9, 10, 11 = 3 ngày
        Assert.Equal(3m, AnnualLeavePolicy.AccruedInYear(2026, new DateOnly(2026, 9, 15), null, new DateOnly(2026, 11, 5)));
    }

    [Fact]
    public void Unused_days_carry_over_without_expiry()
    {
        // Vào 01/01/2024, tới 05/11/2026: 12 + 12 + 11 = 35 ngày tích luỹ (chưa trừ ngày đã dùng)
        Assert.Equal(35m, AnnualLeavePolicy.AccruedTotal(new DateOnly(2024, 1, 1), null, new DateOnly(2026, 11, 5)));
    }

    [Fact]
    public void Stops_accruing_after_leaving()
    {
        // Vào 01/01/2020 → năm 2026 được 13 ngày (6 năm thâm niên). Nghỉ việc 20/03/2026 → chỉ tính tháng 1–3: 13 × 3/12 = 3.25
        Assert.Equal(3.25m, AnnualLeavePolicy.AccruedInYear(2026, new DateOnly(2020, 1, 1), new DateOnly(2026, 3, 20), new DateOnly(2026, 11, 5)));
        Assert.Equal(0m, AnnualLeavePolicy.AccruedInYear(2027, new DateOnly(2020, 1, 1), new DateOnly(2026, 3, 20), new DateOnly(2027, 5, 1)));
    }

    [Fact]
    public void Seniority_bonus_is_spread_monthly()
    {
        // 13 ngày/năm, 6 tháng → 6.5 ngày
        Assert.Equal(6.5m, AnnualLeavePolicy.AccruedInYear(2026, new DateOnly(2021, 1, 1), null, new DateOnly(2026, 6, 10)));
    }
}
