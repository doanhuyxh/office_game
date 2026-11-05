using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Positions;

public sealed record PositionDto(Guid Id, string Name, int SortOrder, int EmployeeCount);
public sealed record UpsertPositionRequest(string Name, int SortOrder = 0);

internal static class PositionEndpoints
{
    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/positions").WithTags("Organization");
        g.MapGet("/", ListAsync);
        g.MapPost("/", CreateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    private static async Task<Ok<List<PositionDto>>> ListAsync(OrgDbContext db, CancellationToken ct)
    {
        var counts = await db.Employees.Where(e => e.Status != EmployeeStatus.Resigned && e.PositionId != null)
            .GroupBy(e => e.PositionId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var list = await db.Positions.AsNoTracking().OrderBy(p => p.SortOrder).ThenBy(p => p.Name).ToListAsync(ct);
        return TypedResults.Ok(list.Select(p => new PositionDto(p.Id, p.Name, p.SortOrder, counts.GetValueOrDefault(p.Id))).ToList());
    }

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateAsync(UpsertPositionRequest req, OrgDbContext db, CancellationToken ct)
    {
        var v = await ValidateAsync(req, null, db, ct);
        if (v.Failed) return v.Problem();
        var p = new Position { Name = req.Name.Trim(), SortOrder = req.SortOrder };
        db.Positions.Add(p);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/org/positions/{p.Id}", p.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdateAsync(Guid id, UpsertPositionRequest req, OrgDbContext db, CancellationToken ct)
    {
        var p = await db.Positions.FindAsync([id], ct);
        if (p is null) return TypedResults.NotFound();
        var v = await ValidateAsync(req, id, db, ct);
        if (v.Failed) return v.Problem();
        p.Name = req.Name.Trim();
        p.SortOrder = req.SortOrder;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid id, OrgDbContext db, CancellationToken ct)
    {
        var p = await db.Positions.FindAsync([id], ct);
        if (p is null) return TypedResults.NotFound();
        if (await db.Employees.AnyAsync(e => e.PositionId == id && e.Status != EmployeeStatus.Resigned, ct))
            return Problems.Conflict("Chức vụ đang có nhân viên, hãy đổi chức vụ cho họ trước");
        p.DeletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Validation> ValidateAsync(UpsertPositionRequest r, Guid? selfId, OrgDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Name, "name", "Tên chức vụ").MaxLength(r.Name, 150, "name", "Tên chức vụ");
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.Positions.AnyAsync(x => x.Name == r.Name.Trim() && x.Id != selfId, ct))
            v.Add("name", "Tên chức vụ đã tồn tại");
        return v;
    }
}
