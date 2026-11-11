using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Tests;

public class AiUsageRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 11);

    [Fact]
    public void Default_range_is_last_30_days_including_today()
    {
        var r = AiUsageRules.ParseRange(null, null, Today, out var err);
        Assert.Null(err);
        Assert.Equal((new DateOnly(2026, 10, 13), Today), r);
    }

    [Fact]
    public void Range_is_clamped_to_today_and_retention()
    {
        var r = AiUsageRules.ParseRange("2025-01-01", "2027-01-01", Today, out _);
        Assert.Equal((Today.AddDays(-(AuditRules.AiRetentionDays - 1)), Today), r);
    }

    [Fact]
    public void Single_day_range_is_allowed()
    {
        Assert.Equal((Today, Today), AiUsageRules.ParseRange("2026-11-11", "2026-11-11", Today, out _));
    }

    [Theory]
    [InlineData("2026/11/01", null, "from")]
    [InlineData(null, "11-11-2026", "to")]
    [InlineData("2026-11-10", "2026-11-01", "from")]
    public void Bad_range_reports_field(string? from, string? to, string field)
    {
        Assert.Null(AiUsageRules.ParseRange(from, to, Today, out var err));
        Assert.Equal(field, err);
    }

    [Fact]
    public void Instants_follow_office_time_zone()
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
        var (start, end) = AiUsageRules.ToInstants(new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 11), tz);
        Assert.Equal(new DateTimeOffset(2026, 10, 31, 17, 0, 0, TimeSpan.Zero), start);
        Assert.Equal(new DateTimeOffset(2026, 11, 11, 17, 0, 0, TimeSpan.Zero), end);
        Assert.Equal(TimeSpan.Zero, start.Offset);
    }

    [Fact]
    public void Descendants_include_whole_subtree_only()
    {
        Guid a = Guid.NewGuid(), b = Guid.NewGuid(), c = Guid.NewGuid(), other = Guid.NewGuid();
        var tree = new (Guid, Guid?)[] { (a, null), (b, a), (c, b), (other, null) };
        Assert.Equal(new HashSet<Guid> { a, b, c }, AiUsageRules.WithDescendants(a, tree));
        Assert.Equal(new HashSet<Guid> { b, c }, AiUsageRules.WithDescendants(b, tree));
    }

    [Fact]
    public void FillDays_adds_missing_days_as_empty()
    {
        var from = new DateOnly(2026, 11, 1);
        var data = new Dictionary<DateOnly, int> { [from.AddDays(1)] = 5 };
        Assert.Equal([0, 5, 0], AiUsageRules.FillDays(from, from.AddDays(2), data, _ => 0));
    }
}
