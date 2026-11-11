using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Tests;

/// <summary>Truy vấn báo cáo AI phải dịch được hết sang SQL (không tính trong RAM) — kiểm tra SQL sinh ra, không cần DB.</summary>
public class AiUsageQueriesTests
{
    private static readonly AuditDbContext Db =
        new(new DbContextOptionsBuilder<AuditDbContext>().UseNpgsql("Host=localhost;Database=x").Options);

    [Fact]
    public void Daily_groups_by_office_date_in_sql()
    {
        var sql = AiUsageQueries.Daily(Db.AiRequests, "Asia/Ho_Chi_Minh").ToQueryString();
        Assert.Contains("AT TIME ZONE", sql);
        Assert.Contains("GROUP BY", sql);
    }

    [Fact]
    public void All_aggregates_translate()
    {
        foreach (var sql in new[]
        {
            AiUsageQueries.Summary(Db.AiRequests).ToQueryString(),
            AiUsageQueries.ByTool(Db.AiRequests).ToQueryString(),
            AiUsageQueries.ByClient(Db.AiRequests).ToQueryString(),
            AiUsageQueries.ByIp(Db.AiRequests, 20).ToQueryString(),
            AiUsageQueries.ByUser(Db.AiRequests).ToQueryString(),
            AiUsageQueries.ByUserClient(Db.AiRequests).ToQueryString(),
        })
            Assert.Contains("GROUP BY", sql);
        Assert.Contains("count(DISTINCT", AiUsageQueries.ByUser(Db.AiRequests).ToQueryString());
    }
}
