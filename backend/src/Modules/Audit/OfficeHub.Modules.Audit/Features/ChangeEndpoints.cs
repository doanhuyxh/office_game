using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auditing;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Features;

public sealed record ChangeDto(Guid Id, DateTimeOffset OccurredAt, string Source, Guid? UserId, string? UserName, string Module, string Entity,
    string EntityId, string? EntityLabel, string Action, IReadOnlyList<FieldChange> Changes);

/// <summary>Lịch sử sửa dữ liệu nhân sự (HR). Lọc theo loại dữ liệu, một bản ghi cụ thể, người sửa, từ khoá; phân trang lùi bằng before.</summary>
internal static class ChangeEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/changes", ListAsync).RequireAuthorization(AuthPolicies.Hr);

    private static async Task<Results<Ok<List<ChangeDto>>, ValidationProblem>> ListAsync(string? entity, string? entityId, Guid? userId,
        string? search, string? before, int? take, AuditDbContext db, CancellationToken ct)
    {
        var q = db.Changes.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(entity)) q = q.Where(x => x.Entity == entity);
        if (!string.IsNullOrWhiteSpace(entityId)) q = q.Where(x => x.EntityId == entityId);
        if (userId is { } uid) q = q.Where(x => x.UserId == uid);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = $"%{search.Trim()}%";
            q = q.Where(x => (x.EntityLabel != null && EF.Functions.ILike(x.EntityLabel, s)) || (x.UserName != null && EF.Functions.ILike(x.UserName, s)));
        }
        if (!string.IsNullOrWhiteSpace(before))
        {
            if (!Instants.TryParse(before, out var b)) return new Validation().Add("before", Instants.MissingZoneMessage).Problem();
            q = q.Where(x => x.OccurredAt < b);
        }
        var rows = await q.OrderByDescending(x => x.OccurredAt).Take(Math.Clamp(take ?? 50, 1, 200)).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => new ChangeDto(r.Id, r.OccurredAt, r.Source, r.UserId, r.UserName, r.Module, r.Entity, r.EntityId,
            r.EntityLabel, r.Action, JsonSerializer.Deserialize<List<FieldChange>>(r.ChangesJson, ChangeAuditWriter.Json) ?? [])).ToList());
    }
}
