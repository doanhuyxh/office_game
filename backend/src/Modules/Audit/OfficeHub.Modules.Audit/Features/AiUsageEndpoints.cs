using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Audit.Features;

/// <param name="Errors">Status ≥ 400, trừ bị chặn.</param>
/// <param name="Blocked">403 (route / quyền không cho phép) + 429 (vượt giới hạn request / phút).</param>
public sealed record AiUsageSummary(int Total, int Users, int Writes, int Errors, int Blocked, int AvgDurationMs, DateTimeOffset? LastAt);
public sealed record AiUsageDay(DateOnly Date, int Total, int Errors, int Blocked);
/// <param name="Tool">Tên tool MCP; null = gọi API trực tiếp bằng token (kể cả Mcp kiểm tra token).</param>
public sealed record AiUsageTool(string? Tool, int Total, int Errors, int Users);
public sealed record AiUsageClient(string ClientName, int Total, int Users);
public sealed record AiUsageIp(string Ip, int Total, DateTimeOffset LastAt);
/// <param name="Ips">Chỉ khi lọc một người (<c>userId</c>): các IP đã dùng, nhiều nhất trước.</param>
public sealed record AiUsageReport(DateOnly From, DateOnly To, AiUsageSummary Summary, IReadOnlyList<AiUsageDay> Daily,
    IReadOnlyList<AiUsageTool> ByTool, IReadOnlyList<AiUsageClient> ByClient, IReadOnlyList<AiUsageIp>? Ips);
public sealed record AiUsageUserRow(Guid UserId, string? FullName, string? UserName, string? EmployeeCode, string? DepartmentName, bool IsBot,
    int Total, int Writes, int Errors, int Blocked, int Ips, string? TopClient, DateTimeOffset LastAt);

/// <summary>
/// Báo cáo sử dụng trợ lý AI (trang Báo cáo → tab Trợ lý AI), tổng hợp từ <c>audit.ai_requests</c> bằng GROUP BY trên DB.
/// HR / admin: mọi người (lọc phòng ban); quản lý: bản thân + cấp dưới. Token AI không đọc được.
/// Lọc chung: <c>from</c>/<c>to</c> (yyyy-MM-dd, lịch VN, mặc định 30 ngày, tối đa hạn lưu 180 ngày), <c>departmentId</c>,
/// <c>client</c> (tên token / ứng dụng), <c>kind</c> = tool | api.
/// </summary>
internal static class AiUsageEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var u = g.MapGroup("/ai-usage").RequireAuthorization(AuthPolicies.Manager);
        u.MapGet("", ReportAsync);
        u.MapGet("/users", UsersAsync);
    }

    internal static DateOnly Today(IOptions<OfficeSettings> office, TimeProvider clock) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone)).DateTime);

    private sealed record Filter(DateOnly From, DateOnly To, AiUsageScope Scope, IQueryable<AiRequestLog> Query);

    /// <summary>Lỗi của <see cref="BuildAsync"/>: đúng một trong hai.</summary>
    private sealed record Failure(ValidationProblem? Invalid, ProblemHttpResult? Denied)
    {
        public static Failure Forbid(string msg) => new(null, TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden));
        public static Failure Field(string field, string msg) => new(new Validation().Add(field, msg).Problem(), null);
    }

    /// <summary>Kiểm tra quyền + tham số, trả truy vấn đã lọc; lỗi → kết quả HTTP.</summary>
    private static async Task<(Filter? F, Failure? Error)> BuildAsync(ClaimsPrincipal user, string? from, string? to, Guid? departmentId,
        Guid? userId, string? client, string? kind, AuditDbContext db, IEmployeeDirectory dir, IOptions<OfficeSettings> office, TimeProvider clock,
        CancellationToken ct)
    {
        if (user.IsAccessToken()) return (null, Failure.Forbid("Chỉ xem khi đăng nhập trên web"));
        if (AiUsageRules.ParseRange(from, to, Today(office, clock), out var bad) is not { } range)
            return (null, Failure.Field(bad!, "Ngày không hợp lệ (yyyy-MM-dd, từ ngày ≤ đến ngày)"));
        if (kind is not (null or "" or "tool" or "api")) return (null, Failure.Field("kind", "Loại phải là tool hoặc api"));

        var scope = await AiUsageScope.ResolveAsync(user, dir, range.From, range.To, departmentId, ct);
        if (scope is null) return (null, Failure.Forbid("Không có quyền xem"));
        if (userId is { } one && !scope.Contains(one)) return (null, Failure.Forbid("Không có quyền xem người này"));

        var (start, end) = AiUsageRules.ToInstants(range.From, range.To, TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone));
        var q = db.AiRequests.AsNoTracking().Where(x => x.OccurredAt >= start && x.OccurredAt < end);
        if (scope.UserIds is { } ids) q = q.Where(x => ids.Contains(x.UserId));
        if (userId is { } uid) q = q.Where(x => x.UserId == uid);
        if (!string.IsNullOrWhiteSpace(client)) { var c = client.Trim(); q = q.Where(x => x.ClientName == c); }
        if (kind == "tool") q = q.Where(x => x.Tool != null);
        else if (kind == "api") q = q.Where(x => x.Tool == null);
        return (new Filter(range.From, range.To, scope, q), null);
    }

    private static async Task<Results<Ok<AiUsageReport>, ValidationProblem, ProblemHttpResult>> ReportAsync(string? from, string? to, Guid? departmentId, Guid? userId, string? client, string? kind,
        ClaimsPrincipal user, AuditDbContext db, IEmployeeDirectory dir, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var (f, error) = await BuildAsync(user, from, to, departmentId, userId, client, kind, db, dir, office, clock, ct);
        if (f is null) return error!.Invalid is { } v1 ? v1 : error.Denied!;
        var q = f.Query;
        var tz = office.Value.TimeZone;

        var s = await AiUsageQueries.Summary(q).FirstOrDefaultAsync(ct);
        var summary = s is null ? new AiUsageSummary(0, 0, 0, 0, 0, 0, null)
            : new AiUsageSummary(s.Total, s.Users, s.Writes, s.Errors, s.Blocked, (int)Math.Round(s.AvgMs), s.Last);
        var days = await AiUsageQueries.Daily(q, tz).ToDictionaryAsync(d => d.Date, ct);
        var daily = AiUsageRules.FillDays(f.From, f.To, days, d => new AiUsageQueries.DayRow(d, 0, 0, 0))
            .Select(d => new AiUsageDay(d.Date, d.Total, d.Errors, d.Blocked)).ToList();
        var byTool = (await AiUsageQueries.ByTool(q).ToListAsync(ct)).Select(t => new AiUsageTool(t.Tool, t.Total, t.Errors, t.Users)).ToList();
        var byClient = (await AiUsageQueries.ByClient(q).ToListAsync(ct)).Select(c => new AiUsageClient(c.ClientName, c.Total, c.Users)).ToList();
        List<AiUsageIp>? ips = userId is null ? null
            : (await AiUsageQueries.ByIp(q, 20).ToListAsync(ct)).Select(i => new AiUsageIp(i.Ip, i.Total, i.Last)).ToList();

        return TypedResults.Ok(new AiUsageReport(f.From, f.To, summary, daily, byTool, byClient, ips));
    }

    /// <summary>
    /// Xếp hạng theo người (chỉ người có request trong kỳ). <c>sort</c> = total (mặc định) | writes | errors | blocked | ips | last | name.
    /// Số người ít (≤ vài trăm) → tính đủ rồi sắp xếp / cắt trang trong bộ nhớ.
    /// </summary>
    private static async Task<Results<Ok<List<AiUsageUserRow>>, Ok<PagedResult<AiUsageUserRow>>, ValidationProblem, ProblemHttpResult>> UsersAsync(string? from, string? to, Guid? departmentId, string? client, string? kind, string? sort,
        int? page, int? pageSize, ClaimsPrincipal user, AuditDbContext db, IEmployeeDirectory dir, IAccountService accounts,
        IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var (f, error) = await BuildAsync(user, from, to, departmentId, null, client, kind, db, dir, office, clock, ct);
        if (f is null) return error!.Invalid is { } v1 ? v1 : error.Denied!;
        var q = f.Query;

        var stats = await AiUsageQueries.ByUser(q).ToListAsync(ct);
        var clients = await AiUsageQueries.ByUserClient(q).ToListAsync(ct);
        var topClient = clients.GroupBy(c => c.UserId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(c => c.Total).ThenBy(c => c.ClientName).First().ClientName);
        var people = await accounts.GetManyAsync(stats.Select(s => s.UserId).ToList(), ct);

        var rows = stats.Select(s =>
        {
            people.TryGetValue(s.UserId, out var a);
            f.Scope.Employees.TryGetValue(s.UserId, out var e);
            return new AiUsageUserRow(s.UserId, e?.FullName ?? a?.FullName, a?.UserName, e?.Code, e?.DepartmentName, a?.IsBot ?? false,
                s.Total, s.Writes, s.Errors, s.Blocked, s.Ips, topClient.GetValueOrDefault(s.UserId), s.Last);
        });
        IOrderedEnumerable<AiUsageUserRow> ordered = sort switch
        {
            "writes" => rows.OrderByDescending(r => r.Writes),
            "errors" => rows.OrderByDescending(r => r.Errors),
            "blocked" => rows.OrderByDescending(r => r.Blocked),
            "ips" => rows.OrderByDescending(r => r.Ips),
            "last" => rows.OrderByDescending(r => r.LastAt),
            "name" => rows.OrderBy(r => r.FullName ?? r.UserName, StringComparer.Create(new System.Globalization.CultureInfo("vi-VN"), true)),
            _ => rows.OrderByDescending(r => r.Total),
        };
        var list = ordered.ThenByDescending(r => r.Total).ThenBy(r => r.UserId).ToList();
        return page is { } p ? TypedResults.Ok(Paging.Of(list, p, pageSize)) : TypedResults.Ok(list);
    }
}
