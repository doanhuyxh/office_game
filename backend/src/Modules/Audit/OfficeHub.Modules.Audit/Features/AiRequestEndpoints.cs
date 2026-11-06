using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Audit.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;

namespace OfficeHub.Modules.Audit.Features;

public sealed record AiRequestDto(Guid Id, DateTimeOffset OccurredAt, Guid UserId, string? UserName, string? FullName, string ClientName,
    bool ViaOAuth, string? Tool, string Method, string Path, int Status, int DurationMs);

/// <summary>Nhật ký thao tác của trợ lý AI. Nhân viên: của mình; HR: mọi người (lọc userId). Token AI không đọc được (không có trong danh sách cho phép).</summary>
internal static class AiRequestEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/ai-requests", ListAsync);

    private static async Task<Results<Ok<List<AiRequestDto>>, ValidationProblem, ProblemHttpResult>> ListAsync(Guid? userId, string? before, int? take,
        ClaimsPrincipal user, AuditDbContext db, IAccountService accounts, CancellationToken ct)
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
        var filterUser = user.IsHr() ? userId : me;

        var q = db.AiRequests.AsNoTracking();
        if (filterUser is { } uid) q = q.Where(x => x.UserId == uid);
        if (cursor is { } b) q = q.Where(x => x.OccurredAt < b);
        var rows = await q.OrderByDescending(x => x.OccurredAt).Take(Math.Clamp(take ?? 50, 1, 200)).ToListAsync(ct);

        var people = await accounts.GetManyAsync(rows.Select(r => r.UserId).Distinct().ToList(), ct);
        return TypedResults.Ok(rows.Select(r =>
        {
            people.TryGetValue(r.UserId, out var a);
            return new AiRequestDto(r.Id, r.OccurredAt, r.UserId, a?.UserName, a?.FullName, r.ClientName, r.ViaOAuth, r.Tool,
                r.Method, r.Path, r.Status, r.DurationMs);
        }).ToList());
    }
}
