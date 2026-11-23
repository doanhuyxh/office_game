using OfficeHub.Modules.Sales.Domain;
using static OfficeHub.Modules.Sales.Domain.SalesRules;

namespace OfficeHub.Modules.Sales.Tests;

public class SalesOutlookRulesTests
{
    private static readonly DateOnly Today = new(2026, 11, 23);

    [Fact]
    public void Receivables_sum_remaining_and_bucket_overdue_by_age()
    {
        var r = SummarizeReceivables([
            (100, 100, Today.AddDays(-200)),   // đã thu đủ → bỏ
            (100, 40, Today.AddDays(-10)),     // quá hạn 1-30, còn 60
            (50, 0, Today.AddDays(-45)),       // 31-60
            (70, 0, Today.AddDays(-75)),       // 61-90
            (80, 0, Today.AddDays(-91)),       // >90
            (20, 0, Today.AddDays(-30)),       // 1-30 (biên)
            (30, 0, Today),                    // đến hạn hôm nay: chưa quá hạn, sắp đến hạn
            (90, 10, Today.AddDays(30)),       // chưa đến hạn, còn 80
        ], Today);
        Assert.Equal(60 + 50 + 70 + 80 + 20 + 30 + 80, r.Outstanding);
        Assert.Equal(60 + 50 + 70 + 80 + 20, r.Overdue);
        Assert.Equal(5, r.OverdueCount);
        Assert.Equal(30, r.DueSoon);
        Assert.Equal(["1-30", "31-60", "61-90", ">90"], r.Aging.Select(a => a.Bucket));
        Assert.Equal([80L, 50L, 70L, 80L], r.Aging.Select(a => a.Amount));
        Assert.Equal([2, 1, 1, 1], r.Aging.Select(a => a.Count));
    }

    [Fact]
    public void Receivables_empty_still_lists_all_buckets()
    {
        var r = SummarizeReceivables([], Today);
        Assert.Equal(0, r.Outstanding);
        Assert.Equal(4, r.Aging.Count);
        Assert.All(r.Aging, a => Assert.Equal(0, a.Amount));
    }

    [Fact]
    public void Pipeline_counts_open_opportunities_only_with_weighted_value()
    {
        var p = SummarizePipeline([
            (OpportunityStage.Lead, 1_000, 10),
            (OpportunityStage.Negotiating, 2_000, 70),
            (OpportunityStage.Negotiating, 1_000, 50),
            (OpportunityStage.Won, 9_000, 100),
            (OpportunityStage.Lost, 9_000, 0),
        ]);
        Assert.Equal(3, p.OpenCount);
        Assert.Equal(4_000, p.OpenValue);
        Assert.Equal(100 + 1_400 + 500, p.Weighted);
        Assert.Equal(["Lead", "Contacted", "Quoted", "Negotiating"], p.ByStage.Select(s => s.Stage));
        var neg = p.ByStage.Single(s => s.Stage == "Negotiating");
        Assert.Equal((2, 3_000L, 1_900L), (neg.Count, neg.Value, neg.Weighted));
        Assert.Equal(0, p.ByStage.Single(s => s.Stage == "Contacted").Count);
    }
}
