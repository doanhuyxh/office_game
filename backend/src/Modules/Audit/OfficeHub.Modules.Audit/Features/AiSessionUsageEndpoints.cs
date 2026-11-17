using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Office;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;

namespace OfficeHub.Modules.Audit.Features;

/// <param name="UserId">Người đang xem; null = mọi người (<c>userId=all</c>, admin / HR).</param>
public sealed record AiSessionUsageSummary(DateOnly From, DateOnly To, string Group, Guid? UserId,
    IReadOnlyList<AiUsageGroup> Groups, IReadOnlyList<AiUsageTotal> Buckets, AiUsageTotal Total);

public sealed record AiSessionUsageModelDto(string Model, long? InputTokens, long? OutputTokens, long? CacheReadTokens, long? CacheWriteTokens, decimal? CostUsd);

/// <param name="DurationSeconds">FinishedAt − StartedAt.</param>
public sealed record AiSessionUsageDto(Guid Id, Guid UserId, string? UserName, string? FullName, string SourceId, string Kind, Guid? TaskId,
    Guid? ProjectId, string? TaskCode, string Executor, string Status, DateTimeOffset StartedAt, DateTimeOffset FinishedAt, int DurationSeconds,
    int? Turns, decimal? CostUsd, long InputTokens, long OutputTokens, long CacheReadTokens, long CacheWriteTokens,
    IReadOnlyList<AiSessionUsageModelDto> Models);

/// <summary>
/// Mức dùng AI theo phiên agent (TEST-134).
/// - Ghi: <c>POST /api/audit/internal/ai-usage</c> — chỉ OfficeHub.Mcp gọi (khoá <c>Chat__McpToApiKey</c> / <c>Chat__InternalKey</c>, nginx chặn từ ngoài),
///   sau khi Mcp xác thực token là tài khoản bot. Không ghi vào nhật ký AI.
/// - Đọc: <c>/api/ai-usage/*</c> bằng cookie (token AI → 403). Không có userId = của mình; người khác / <c>all</c> → chỉ admin / HR.
/// </summary>
internal static class AiSessionUsageEndpoints
{
    public static void MapInternal(RouteGroupBuilder g) => g.MapPost("/ai-usage", IngestAsync);

    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/summary", SummaryAsync);
        g.MapGet("/sessions", SessionsAsync);
        g.MapGet("/export", AiSessionUsageExport.ExportAsync);
    }

    private static async Task<Results<Ok<AiUsageAccepted>, ProblemHttpResult>> IngestAsync(AiUsageBatch? body, HttpRequest http,
        IOptions<ChatSettings> settings, AuditDbContext db, TimeProvider clock, CancellationToken ct)
    {
        if (!BotActivityRoute.KeyMatches(http.Headers[AiUsageRoute.KeyHeader].ToString(), settings.Value.McpApiKey))
            return TypedResults.Problem("Khoá nội bộ không đúng", statusCode: StatusCodes.Status401Unauthorized);
        if (body is null || body.UserId == Guid.Empty) return TypedResults.Problem("Thiếu userId", statusCode: StatusCodes.Status400BadRequest);
        var now = clock.GetUtcNow();
        if (AiUsageRoute.Validate(body.Sessions, now) is { } err) return TypedResults.Problem(err, statusCode: StatusCodes.Status400BadRequest);
        var sessions = body.Sessions!.Select(s => s!).ToList();
        return TypedResults.Ok(await AiSessionUsageStore.UpsertAsync(db, body.UserId, sessions, now, ct));
    }

    /// <summary>Quyền + tham số chung của các route đọc.</summary>
    internal sealed record Query(DateOnly From, DateOnly To, string Group, Guid? UserId, TimeZoneInfo Tz, IQueryable<AiSessionUsage> Sessions);

    /// <summary>Lỗi của <see cref="Build"/>: đúng một trong hai.</summary>
    internal sealed record Failure(ValidationProblem? Invalid, ProblemHttpResult? Denied)
    {
        public static Failure Forbid(string msg) => new(null, TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden));
        public static Failure Field(string field, string msg) => new(new Validation().Add(field, msg).Problem(), null);
    }

    internal static (Query? Q, Failure? Error) Build(ClaimsPrincipal user, string? from, string? to, string? group, string? userId,
        AuditDbContext db, IOptions<OfficeSettings> office, TimeProvider clock)
    {
        if (user.IsAccessToken() || user.GetUserId() is not { } me)
            return (null, Failure.Forbid("Chỉ xem khi đăng nhập trên web"));
        var g = string.IsNullOrWhiteSpace(group) ? AiSessionLedger.Day : group.Trim();
        if (!AiSessionLedger.IsGroup(g)) return (null, Failure.Field("group", "Nhóm phải là day, month hoặc year"));
        var (scope, denied) = AiSessionLedger.ResolveScope(me, user.IsHr(), userId);
        if (denied == "invalid") return (null, Failure.Field("userId", "userId phải là id tài khoản hoặc all"));
        if (scope is null) return (null, Failure.Forbid("Chỉ admin / HR xem được mức dùng AI của người khác"));
        var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
        if (AiSessionLedger.ParseRange(from, to, g, AiUsageEndpoints.Today(office, clock), out var bad) is not { } range)
            return (null, Failure.Field(bad!, $"Ngày không hợp lệ (yyyy-MM-dd, từ ngày ≤ đến ngày, tối đa {AiSessionLedger.MaxRangeDays} ngày)"));

        var (start, end) = AiUsageRules.ToInstants(range.From, range.To, tz);
        var q = db.AiUsageSessions.AsNoTracking().Where(s => s.FinishedAt >= start && s.FinishedAt < end);
        if (scope.UserId is { } uid) q = q.Where(s => s.UserId == uid);
        return (new Query(range.From, range.To, g, scope.UserId, tz, q), null);
    }

    /// <summary>Dòng (phiên × model) của khoảng — chỉ các cột cần để gộp; gộp ngày / tháng / năm theo giờ VN ở <see cref="AiSessionLedger.Summarize"/>.</summary>
    internal static Task<List<AiUsageRow>> RowsAsync(Query q, AuditDbContext db, CancellationToken ct) =>
        (from s in q.Sessions
         join m in db.AiUsageModels.AsNoTracking() on s.Id equals m.SessionId
         select new AiUsageRow(s.Id, s.FinishedAt, s.CostUsd, m.Model, m.InputTokens, m.OutputTokens, m.CacheReadTokens, m.CacheWriteTokens, m.CostUsd))
        .ToListAsync(ct);

    private static async Task<Results<Ok<AiSessionUsageSummary>, ValidationProblem, ProblemHttpResult>> SummaryAsync(string? from, string? to, string? group, string? userId, ClaimsPrincipal user,
        AuditDbContext db, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var (q, error) = Build(user, from, to, group, userId, db, office, clock);
        if (q is null) return error!.Invalid is { } v ? v : error.Denied!;
        var data = AiSessionLedger.Summarize(await RowsAsync(q, db, ct), q.Group, q.Tz);
        return TypedResults.Ok(new AiSessionUsageSummary(q.From, q.To, q.Group, q.UserId, data.Groups, data.Buckets, data.Total));
    }

    /// <summary>Danh sách phiên mới nhất trước; có <c>page</c> → <see cref="PagedResult{T}"/>, không có → 200 phiên gần nhất.</summary>
    private static async Task<Results<Ok<List<AiSessionUsageDto>>, Ok<PagedResult<AiSessionUsageDto>>, ValidationProblem, ProblemHttpResult>> SessionsAsync(string? from, string? to, string? userId, int? page, int? pageSize, ClaimsPrincipal user,
        AuditDbContext db, IAccountService accounts, IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var (q, error) = Build(user, from, to, null, userId, db, office, clock);
        if (q is null) return error!.Invalid is { } v ? v : error.Denied!;
        var ordered = q.Sessions.Include(s => s.Models).OrderByDescending(s => s.FinishedAt).ThenByDescending(s => s.Id);
        if (page is { } p)
        {
            var paged = await ordered.ToPagedAsync(p, pageSize, ct);
            var names = await accounts.GetManyAsync(paged.Items.Select(s => s.UserId).Distinct().ToList(), ct);
            return TypedResults.Ok(paged.Map(s => ToDto(s, names)));
        }
        var list = await ordered.Take(200).ToListAsync(ct);
        var all = await accounts.GetManyAsync(list.Select(s => s.UserId).Distinct().ToList(), ct);
        return TypedResults.Ok(list.Select(s => ToDto(s, all)).ToList());
    }

    internal static AiSessionUsageDto ToDto(AiSessionUsage s, IReadOnlyDictionary<Guid, AccountInfo> names)
    {
        names.TryGetValue(s.UserId, out var a);
        var models = s.Models.OrderBy(m => m.Model, StringComparer.Ordinal)
            .Select(m => new AiSessionUsageModelDto(m.Model, m.InputTokens, m.OutputTokens, m.CacheReadTokens, m.CacheWriteTokens, m.CostUsd)).ToList();
        return new AiSessionUsageDto(s.Id, s.UserId, a?.UserName, a?.FullName, s.SourceId, s.Kind, s.TaskId, s.ProjectId, s.TaskCode, s.Executor,
            s.Status, s.StartedAt, s.FinishedAt, (int)Math.Max(0, (s.FinishedAt - s.StartedAt).TotalSeconds), s.Turns, s.CostUsd,
            models.Sum(m => m.InputTokens ?? 0), models.Sum(m => m.OutputTokens ?? 0), models.Sum(m => m.CacheReadTokens ?? 0),
            models.Sum(m => m.CacheWriteTokens ?? 0), models);
    }
}
