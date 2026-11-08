using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;
using OfficeHub.Modules.Sales.Contracts;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="Appendix">Phụ lục (module Sales) đã lập từ CR này — không có số tiền.</param>
public sealed record ChangeRequestDto(Guid Id, int Number, string Code, string Title, string? Description, decimal? EstimateManDays, bool Billable,
    ChangeRequestStatus Status, DateOnly? SentOn, DateOnly? DecidedOn, string? DecidedByName, string? DecisionNote, decimal? BudgetAddedManDays,
    DateTimeOffset CreatedAt, string CreatedByName, AppendixRef? Appendix);
public sealed record UpsertChangeRequest(string Title, string? Description = null, decimal? EstimateManDays = null, bool Billable = false);
public sealed record MoveChangeRequest(ChangeRequestStatus Status, DateOnly? DecidedOn = null, string? Note = null);

/// <summary>
/// Yêu cầu thay đổi (CR). Thấy: ai thấy dự án. Tạo / sửa / đổi trạng thái: quản lý dự án / HR (dự án đang chạy). Không có số tiền —
/// giá trị tăng thêm do người phụ trách hợp đồng / kế toán nhập ở phụ lục (module Sales).
/// </summary>
internal static class ChangeRequestEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/{id:guid}/change-requests", ListAsync);
        g.MapPost("/{id:guid}/change-requests", CreateAsync);
        g.MapPut("/change-requests/{cid:guid}", UpdateAsync);
        g.MapPost("/change-requests/{cid:guid}/status", MoveAsync);
    }

    private static async Task<Results<Ok<List<ChangeRequestDto>>, NotFound>> ListAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        var rows = await db.ChangeRequests.AsNoTracking().Where(c => c.ProjectId == id).OrderByDescending(c => c.Number).ToListAsync(ct);
        var appx = (await sales.AppendicesOfChangeRequestsAsync(rows.Select(r => r.Id).ToList(), ct)).ToDictionary(a => a.ChangeRequestId);
        return TypedResults.Ok(rows.Select(c => new ChangeRequestDto(c.Id, c.Number, ChangeRequestRules.Code(p.Code, c.Number), c.Title, c.Description, c.EstimateManDays,
            c.Billable, c.Status, c.SentOn, c.DecidedOn, c.DecidedByName, c.DecisionNote, c.BudgetAddedManDays, c.CreatedAt, c.CreatedByName, appx.GetValueOrDefault(c.Id))).ToList());
    }

    private static async Task<Validation> ValidateAsync(UpsertChangeRequest r, Project p, ProjectsDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Title, "title", "Tên thay đổi").MaxLength(r.Title, 300, "title", "Tên thay đổi")
            .MaxLength(r.Description, 5000, "description", "Mô tả")
            .When(r.EstimateManDays is < 0 or > 100_000, "estimateManDays", "Ngày công ước tính không hợp lệ");
        if (r.Billable && !await db.ProjectContracts.AnyAsync(x => x.ProjectId == p.Id, ct))
            v.Add("billable", "Dự án chưa gắn hợp đồng bán — không lập phụ lục tính tiền được");
        return v;
    }

    private static async Task<(ChangeRequest? C, Project? P)> LoadAsync(Guid cid, ProjectsDbContext db, CancellationToken ct)
    {
        var c = await db.ChangeRequests.FirstOrDefaultAsync(x => x.Id == cid, ct);
        return c is null ? (null, null) : (c, await db.Projects.FirstOrDefaultAsync(p => p.Id == c.ProjectId, ct));
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, UpsertChangeRequest r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR ghi yêu cầu thay đổi");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var val = await ValidateAsync(r, p, db, ct);
        if (val.Failed) return val.Problem();
        for (var attempt = 0; ; attempt++)
        {
            var number = (await db.ChangeRequests.Where(c => c.ProjectId == id).MaxAsync(c => (int?)c.Number, ct) ?? 0) + 1;
            var c = new ChangeRequest
            {
                ProjectId = id, Number = number, Title = r.Title.Trim(), Description = ProjectEndpoints.Clean(r.Description), EstimateManDays = r.EstimateManDays,
                Billable = r.Billable, Status = ChangeRequestStatus.Draft, CreatedAt = clock.Now, CreatedByName = v.Name,
            };
            db.ChangeRequests.Add(c);
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) when (attempt < 3) { db.ChangeRequests.Remove(c); continue; } // tạo đồng thời → số trùng, thử số kế
            return TypedResults.Created($"/api/projects/change-requests/{c.Id}", c.Id);
        }
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid cid, UpsertChangeRequest r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (c, p) = await LoadAsync(cid, db, ct);
        if (c is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanManage(p.Id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR sửa yêu cầu thay đổi");
        if (!ChangeRequestRules.IsEditable(c.Status)) return Problems.Conflict("Yêu cầu đã chốt (đồng ý / từ chối / huỷ), không sửa được");
        var val = await ValidateAsync(r, p, db, ct);
        if (val.Failed) return val.Problem();
        c.Title = r.Title.Trim(); c.Description = ProjectEndpoints.Clean(r.Description); c.EstimateManDays = r.EstimateManDays; c.Billable = r.Billable;
        c.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Đổi trạng thái (<see cref="ChangeRequestRules.CanMove"/>). Khách đồng ý → cộng ngày công ước tính vào ngân sách dự án (nếu có ngân sách);
    /// có tính tiền → module Sales báo người phụ trách hợp đồng + kế toán lập phụ lục.
    /// </summary>
    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> MoveAsync(Guid cid, MoveChangeRequest r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ISalesContractsLookup sales, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (c, p) = await LoadAsync(cid, db, ct);
        if (c is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanManage(p.Id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR đổi trạng thái yêu cầu thay đổi");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        if (!ChangeRequestRules.CanMove(c.Status, r.Status)) return Problems.Conflict($"Không chuyển được từ {c.Status} sang {r.Status}");
        var decided = r.Status is ChangeRequestStatus.Approved or ChangeRequestStatus.Rejected;
        var on = r.DecidedOn ?? clock.Today;
        if (decided && on > clock.Today) return new Validation().Add("decidedOn", "Ngày khách quyết định không ở tương lai").Problem();
        var note = ProjectEndpoints.Clean(r.Note);
        if (note is { Length: > 1000 }) note = note[..1000];

        c.Status = r.Status;
        c.UpdatedAt = clock.Now;
        if (r.Status == ChangeRequestStatus.Sent) c.SentOn = clock.Today;
        if (r.Status == ChangeRequestStatus.Draft) c.SentOn = null;
        if (decided || r.Status == ChangeRequestStatus.Cancelled) { c.DecidedOn = decided ? on : null; c.DecidedByName = v.Name; c.DecisionNote = note; }
        if (r.Status == ChangeRequestStatus.Approved && ChangeRequestRules.BudgetAddition(p.BudgetManDays, c.EstimateManDays) is { } add)
        {
            p.BudgetManDays += add;
            c.BudgetAddedManDays = add;
            p.UpdatedAt = clock.Now;
        }
        await db.SaveChangesAsync(ct);
        if (r.Status == ChangeRequestStatus.Approved && c.Billable)
        {
            var contracts = await db.ProjectContracts.AsNoTracking().Where(x => x.ProjectId == p.Id).Select(x => x.ContractId).ToListAsync(ct);
            try { await sales.NotifyChangeRequestApprovedAsync(contracts, ChangeRequestRules.Code(p.Code, c.Number), c.Title, $"{p.Code} · {p.Name}", ct); }
            catch { /* thông báo phụ — không làm hỏng việc đổi trạng thái */ }
        }
        return TypedResults.NoContent();
    }
}
