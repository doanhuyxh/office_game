using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>
/// Truy vấn tổng hợp của báo cáo sử dụng AI — chạy hết bằng GROUP BY trên Postgres (test kiểm tra SQL sinh ra: AiUsageQueriesTests).
/// Phân loại: bị chặn = 403 / 429; lỗi = status ≥ 400 còn lại; ghi = method khác GET / HEAD / OPTIONS.
/// </summary>
internal static class AiUsageQueries
{
    internal sealed record SummaryRow(int Total, int Users, int Writes, int Errors, int Blocked, double AvgMs, DateTimeOffset Last);
    internal sealed record DayRow(DateOnly Date, int Total, int Errors, int Blocked);
    internal sealed record ToolRow(string? Tool, int Total, int Errors, int Users);
    internal sealed record ClientRow(string ClientName, int Total, int Users);
    internal sealed record IpRow(string Ip, int Total, DateTimeOffset Last);
    internal sealed record UserRow(Guid UserId, int Total, int Writes, int Errors, int Blocked, int Ips, DateTimeOffset Last);
    internal sealed record UserClientRow(Guid UserId, string ClientName, int Total);

    public static IQueryable<SummaryRow> Summary(IQueryable<AiRequestLog> q) =>
        q.GroupBy(_ => 1).Select(g => new SummaryRow(
            g.Count(),
            g.Select(x => x.UserId).Distinct().Count(),
            g.Count(x => x.Method != "GET" && x.Method != "HEAD" && x.Method != "OPTIONS"),
            g.Count(x => x.Status >= 400 && x.Status != 403 && x.Status != 429),
            g.Count(x => x.Status == 403 || x.Status == 429),
            g.Average(x => (double)x.DurationMs),
            g.Max(x => x.OccurredAt)));

    /// <summary>Theo ngày lịch tại văn phòng: <c>(occurred_at AT TIME ZONE tz)::date</c>.</summary>
    public static IQueryable<DayRow> Daily(IQueryable<AiRequestLog> q, string timeZone) =>
        q.GroupBy(x => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(x.OccurredAt.UtcDateTime, timeZone)))
            .Select(g => new DayRow(g.Key, g.Count(),
                g.Count(x => x.Status >= 400 && x.Status != 403 && x.Status != 429),
                g.Count(x => x.Status == 403 || x.Status == 429)));

    public static IQueryable<ToolRow> ByTool(IQueryable<AiRequestLog> q) =>
        q.GroupBy(x => x.Tool).OrderByDescending(g => g.Count())
            .Select(g => new ToolRow(g.Key, g.Count(), g.Count(x => x.Status >= 400), g.Select(x => x.UserId).Distinct().Count()));

    public static IQueryable<ClientRow> ByClient(IQueryable<AiRequestLog> q) =>
        q.GroupBy(x => x.ClientName).OrderByDescending(g => g.Count())
            .Select(g => new ClientRow(g.Key, g.Count(), g.Select(x => x.UserId).Distinct().Count()));

    public static IQueryable<IpRow> ByIp(IQueryable<AiRequestLog> q, int take) =>
        q.Where(x => x.Ip != null).GroupBy(x => x.Ip!).OrderByDescending(g => g.Count()).Take(take)
            .Select(g => new IpRow(g.Key, g.Count(), g.Max(x => x.OccurredAt)));

    public static IQueryable<UserRow> ByUser(IQueryable<AiRequestLog> q) =>
        q.GroupBy(x => x.UserId).Select(g => new UserRow(
            g.Key,
            g.Count(),
            g.Count(x => x.Method != "GET" && x.Method != "HEAD" && x.Method != "OPTIONS"),
            g.Count(x => x.Status >= 400 && x.Status != 403 && x.Status != 429),
            g.Count(x => x.Status == 403 || x.Status == 429),
            g.Where(x => x.Ip != null).Select(x => x.Ip).Distinct().Count(),
            g.Max(x => x.OccurredAt)));

    public static IQueryable<UserClientRow> ByUserClient(IQueryable<AiRequestLog> q) =>
        q.GroupBy(x => new { x.UserId, x.ClientName }).Select(g => new UserClientRow(g.Key.UserId, g.Key.ClientName, g.Count()));
}
