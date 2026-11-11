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

public sealed record AiRequestDto(Guid Id, DateTimeOffset OccurredAt, Guid UserId, string? UserName, string? FullName, string ClientName,
    bool ViaOAuth, string? Tool, string Method, string Path, int Status, int DurationMs, string? Ip = null,
    // JSON tóm tắt nội dung lệnh ghi (≤ 7 ngày gần nhất), null nếu không có / đã quá hạn.
    string? RequestSummary = null);

/// <summary>Nhật ký thao tác của trợ lý AI. Mặc định: của mình (kể cả HR / quản lý); <c>all=true</c>: HR → mọi người, quản lý → bản thân + cấp dưới (lọc userId trong phạm vi đó). Token AI không đọc được (không có trong danh sách cho phép).</summary>
internal static class AiRequestEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/ai-requests", ListAsync);

    /// <summary>Có <c>page</c> → trang (COUNT + OFFSET/LIMIT); không → <c>take</c> dòng mới nhất (phân trang lùi bằng <c>before</c>).</summary>
    private static async Task<Results<Ok<List<AiRequestDto>>, Ok<PagedResult<AiRequestDto>>, ValidationProblem, ProblemHttpResult>> ListAsync(Guid? userId, bool? all,
        string? before, int? take, int? page, int? pageSize, ClaimsPrincipal user, AuditDbContext db, IAccountService accounts, IEmployeeDirectory dir,
        IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TypedResults.Problem("Chỉ xem khi đăng nhập trên web", statusCode: StatusCodes.Status403Forbidden);
        // before = mốc ISO 8601 kèm múi giờ (phân trang lùi); query string không qua JSON converter → parse chặt tại đây.
        DateTimeOffset? cursor = null;
        if (!string.IsNullOrWhiteSpace(before))
        {
            if (!Instants.TryParse(before, out var c)) return new Validation().Add("before", Instants.MissingZoneMessage).Problem();
            cursor = c;
        }
        var me = user.GetUserId()!.Value;
        var q = db.AiRequests.AsNoTracking();
        if (all == true)
        {
            var today = AiUsageEndpoints.Today(office, clock);
            var scope = await AiUsageScope.ResolveAsync(user, dir, today.AddDays(-(AuditRules.AiRetentionDays - 1)), today, null, ct);
            if (scope is null) return TypedResults.Problem("Không có quyền xem", statusCode: StatusCodes.Status403Forbidden);
            if (userId is { } one && !scope.Contains(one)) return TypedResults.Problem("Không có quyền xem người này", statusCode: StatusCodes.Status403Forbidden);
            if (scope.UserIds is { } ids) q = q.Where(x => ids.Contains(x.UserId));
            if (userId is { } uid) q = q.Where(x => x.UserId == uid);
        }
        else q = q.Where(x => x.UserId == me); // không có all → luôn chỉ của mình
        if (cursor is { } b) q = q.Where(x => x.OccurredAt < b);
        var ordered = q.OrderByDescending(x => x.OccurredAt).ThenByDescending(x => x.Id);
        var paged = page is { } pg ? await ordered.ToPagedAsync(pg, pageSize, ct) : null;
        var rows = paged?.Items.ToList() ?? await ordered.Take(Math.Clamp(take ?? 50, 1, 200)).ToListAsync(ct);

        var people = await accounts.GetManyAsync(rows.Select(r => r.UserId).Distinct().ToList(), ct);
        var summaryCutoff = clock.GetUtcNow().AddDays(-AuditRules.AiSummaryRetentionDays);
        var dtos = rows.Select(r =>
        {
            people.TryGetValue(r.UserId, out var a);
            return new AiRequestDto(r.Id, r.OccurredAt, r.UserId, a?.UserName, a?.FullName, r.ClientName, r.ViaOAuth, r.Tool,
                r.Method, r.Path, r.Status, r.DurationMs, r.Ip, r.OccurredAt >= summaryCutoff ? r.RequestSummary : null);
        }).ToList();
        if (paged is null) return TypedResults.Ok(dtos);
        return TypedResults.Ok(paged.With(dtos));
    }
}
