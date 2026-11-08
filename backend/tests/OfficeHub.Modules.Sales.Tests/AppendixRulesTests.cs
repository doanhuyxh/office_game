using static OfficeHub.Modules.Sales.Domain.SalesRules;

namespace OfficeHub.Modules.Sales.Tests;

public class AppendixRulesTests
{
    private static readonly DateOnly Signed = new(2026, 9, 1), Today = new(2026, 11, 11);
    private static List<(string Title, DateOnly DueOn, long Amount)> Items(params long[] amounts) => amounts.Select((a, i) => ($"Đợt {i + 1}", Today, a)).ToList();
    private static List<string> Fields(long delta, long before = 100_000_000, long total = 110_000_000, long scheduled = 110_000_000, DateOnly? on = null,
        List<(string, DateOnly, long)>? items = null) =>
        ValidateAppendix(delta, Total(delta, 10), before, total, scheduled, on ?? Today, Signed, Today, items ?? []).Select(e => e.Field).ToList();

    [Fact]
    public void Increase_with_installments_up_to_the_increase_is_valid()
    {
        Assert.Equal(22_000_000, Total(20_000_000, 10));
        Assert.Empty(Fields(20_000_000, items: Items(10_000_000, 12_000_000)));
        Assert.Empty(Fields(20_000_000)); // đợt thu thêm sau cũng được
    }

    [Fact]
    public void Installments_cannot_exceed_the_increase() => Assert.Contains("installments", Fields(20_000_000, items: Items(22_000_001)));

    [Fact]
    public void Decrease_must_keep_value_above_scheduled_installments()
    {
        Assert.Equal(-11_000_000, Total(-10_000_000, 10));
        Assert.Contains("valueBeforeTaxDelta", Fields(-10_000_000)); // đã lên lịch đủ 110tr
        Assert.Empty(Fields(-10_000_000, scheduled: 99_000_000));
        Assert.Contains("installments", Fields(-10_000_000, scheduled: 0, items: Items(1)));
    }

    [Fact]
    public void Rejects_zero_delta_overshooting_decrease_and_bad_dates()
    {
        Assert.Contains("valueBeforeTaxDelta", Fields(0));
        Assert.Contains("valueBeforeTaxDelta", Fields(-100_000_000, scheduled: 0));
        Assert.Contains("signedOn", Fields(1, on: Signed.AddDays(-1)));
        Assert.Contains("signedOn", Fields(1, on: Today.AddDays(1)));
    }
}
