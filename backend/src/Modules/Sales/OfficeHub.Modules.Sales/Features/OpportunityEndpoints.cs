using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Sales.Domain;
using OfficeHub.Modules.Sales.Infrastructure;

namespace OfficeHub.Modules.Sales.Features;

public sealed record OpportunityDto(Guid Id, Guid CustomerId, string CustomerName, string Title, Guid? BusinessLineId, OpportunityStage Stage, long Value, int Probability,
    long Weighted, DateOnly? ExpectedCloseOn, string? LostReason, Guid OwnerEmployeeId, string OwnerName, DateTimeOffset CreatedAt, DateTimeOffset? ClosedAt);
/// <param name="Probability">null = mặc định theo giai đoạn.</param>
public sealed record UpsertOpportunity(Guid CustomerId, string Title, OpportunityStage Stage = OpportunityStage.Lead, long Value = 0, int? Probability = null,
    Guid? BusinessLineId = null, DateOnly? ExpectedCloseOn = null, string? LostReason = null, Guid? OwnerEmployeeId = null);

/// <summary>Cơ hội bán (pipeline). Giá trị là dự kiến; Thắng / Thua = đóng.</summary>
internal static class OpportunityEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/opportunities", ListAsync);
        g.MapPost("/opportunities", CreateAsync);
        g.MapPut("/opportunities/{id:guid}", UpdateAsync);
    }

    private static async Task<Ok<List<OpportunityDto>>> ListAsync(ClaimsPrincipal user, SalesDbContext db, SalesAccess access, Guid? customerId, Guid? ownerId,
        OpportunityStage? stage, bool? openOnly, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Opportunities.AsNoTracking().AsQueryable();
        if (!v.SeeAll) { var owners = v.Owners.ToList(); q = q.Where(o => owners.Contains(o.OwnerEmployeeId)); }
        if (customerId is { } c) q = q.Where(o => o.CustomerId == c);
        if (ownerId is { } ow) q = q.Where(o => o.OwnerEmployeeId == ow);
        if (stage is { } s) q = q.Where(o => o.Stage == s);
        if (openOnly == true) q = q.Where(o => o.Stage != OpportunityStage.Won && o.Stage != OpportunityStage.Lost);
        var rows = await q.OrderByDescending(o => o.CreatedAt).Take(500).ToListAsync(ct);
        return TypedResults.Ok(await ToDtosAsync(rows, db, access, ct));
    }

    internal static async Task<List<OpportunityDto>> ToDtosAsync(IReadOnlyList<Opportunity> rows, SalesDbContext db, SalesAccess access, CancellationToken ct)
    {
        var names = await db.Customers.AsNoTracking().Where(c => rows.Select(r => r.CustomerId).Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name, ct);
        var emps = await access.EmployeesAsync(ct);
        return rows.Select(o => new OpportunityDto(o.Id, o.CustomerId, names.GetValueOrDefault(o.CustomerId, "?"), o.Title, o.BusinessLineId, o.Stage, o.Value, o.Probability,
            SalesRules.Weighted(o.Value, o.Probability, o.Stage), o.ExpectedCloseOn, o.LostReason, o.OwnerEmployeeId,
            emps.TryGetValue(o.OwnerEmployeeId, out var e) ? e.FullName : "(không rõ)", o.CreatedAt, o.ClosedAt)).ToList();
    }

    private static Validation Validate(UpsertOpportunity r) => new Validation()
        .Required(r.Title, "title", "Tên cơ hội").MaxLength(r.Title, 200, "title", "Tên cơ hội").MaxLength(r.LostReason, 500, "lostReason", "Lý do thua")
        .When(r.Value < 0 || r.Value > SalesRules.MaxAmount, "value", "Giá trị không hợp lệ")
        .When(r.Probability is < 0 or > 100, "probability", "Xác suất từ 0 đến 100")
        .When(r.Stage == OpportunityStage.Lost && string.IsNullOrWhiteSpace(r.LostReason), "lostReason", "Nhập lý do thua");

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(UpsertOpportunity r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, IEmployeeDirectory dir, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var c = await db.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == r.CustomerId, ct);
        if (c is null || !v.CanSee(c.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(c.OwnerEmployeeId)) return CustomerEndpoints.Forbidden();
        var val = Validate(r);
        var owner = r.OwnerEmployeeId ?? c.OwnerEmployeeId;
        if (owner != c.OwnerEmployeeId && await CustomerEndpoints.CheckOwnerAsync(owner, v, dir, ct) is { } err) val.Add("ownerEmployeeId", err);
        if (val.Failed) return val.Problem();
        var now = clock.Now;
        var o = new Opportunity
        {
            CustomerId = c.Id, Title = r.Title.Trim(), BusinessLineId = r.BusinessLineId, Stage = r.Stage, Value = r.Value,
            Probability = r.Probability ?? SalesRules.DefaultProbability(r.Stage), ExpectedCloseOn = r.ExpectedCloseOn,
            LostReason = r.Stage == OpportunityStage.Lost ? r.LostReason!.Trim() : null, OwnerEmployeeId = owner, CreatedAt = now,
            ClosedAt = SalesRules.IsClosed(r.Stage) ? now : null,
        };
        db.Opportunities.Add(o);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/sales/opportunities/{o.Id}", o.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpsertOpportunity r, ClaimsPrincipal user, SalesDbContext db,
        SalesAccess access, IEmployeeDirectory dir, SalesClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var o = await db.Opportunities.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null || !v.CanSee(o.OwnerEmployeeId)) return TypedResults.NotFound();
        if (!v.CanEdit(o.OwnerEmployeeId)) return CustomerEndpoints.Forbidden("Bạn không phụ trách cơ hội này");
        var val = Validate(r);
        if (r.CustomerId != o.CustomerId) val.Add("customerId", "Không đổi khách hàng của cơ hội");
        if (r.OwnerEmployeeId is { } ow && ow != o.OwnerEmployeeId && await CustomerEndpoints.CheckOwnerAsync(ow, v, dir, ct) is { } err) val.Add("ownerEmployeeId", err);
        if (val.Failed) return val.Problem();
        var stageChanged = o.Stage != r.Stage;
        o.Title = r.Title.Trim(); o.BusinessLineId = r.BusinessLineId; o.Value = r.Value; o.ExpectedCloseOn = r.ExpectedCloseOn;
        o.Probability = r.Probability ?? (stageChanged ? SalesRules.DefaultProbability(r.Stage) : o.Probability);
        if (stageChanged) o.ClosedAt = SalesRules.IsClosed(r.Stage) ? clock.Now : null;
        o.Stage = r.Stage;
        o.LostReason = r.Stage == OpportunityStage.Lost ? r.LostReason!.Trim() : null;
        if (r.OwnerEmployeeId is { } newOwner) o.OwnerEmployeeId = newOwner;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
