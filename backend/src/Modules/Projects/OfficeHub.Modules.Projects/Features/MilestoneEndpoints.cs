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

public sealed record MilestoneDto(Guid Id, int Order, string Title, DateOnly? DueOn, MilestoneStatus Status, Guid? InstallmentId, string? InstallmentTitle,
    DateOnly? InstallmentDueOn, DateOnly? AcceptedOn, string? AcceptedByName, string? Note, int TasksOpen, int TasksDone);
public sealed record UpsertMilestone(string Title, DateOnly? DueOn = null, Guid? InstallmentId = null, string? Note = null);
public sealed record AcceptMilestone(DateOnly AcceptedOn, string? Note = null);

/// <summary>Mốc nghiệm thu. Gắn đợt thu của một trong các hợp đồng bán của dự án; nghiệm thu → đợt thu đến hạn (module Sales báo kế toán + người phụ trách HĐ).</summary>
internal static class MilestoneEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/{id:guid}/milestones", CreateAsync);
        g.MapPut("/milestones/{mid:guid}", UpdateAsync);
        g.MapDelete("/milestones/{mid:guid}", DeleteAsync);
        g.MapPost("/milestones/{mid:guid}/accept", AcceptAsync);
    }

    internal static async Task<List<MilestoneDto>> ListForAsync(Project p, ProjectsDbContext db, ISalesContractsLookup sales, CancellationToken ct)
    {
        var rows = await db.Milestones.AsNoTracking().Where(m => m.ProjectId == p.Id).OrderBy(m => m.Order).ToListAsync(ct);
        var inst = (await ProjectEndpoints.InstallmentsOfAsync(db, sales, p.Id, ct)).ToDictionary(i => i.Id);
        var tasks = await db.Tasks.AsNoTracking().Where(t => t.ProjectId == p.Id && t.MilestoneId != null).Select(t => new { t.MilestoneId, Done = t.CompletedAt != null }).ToListAsync(ct);
        return rows.Select(m =>
        {
            var i = m.InstallmentId is { } iid ? inst.GetValueOrDefault(iid) : null;
            return new MilestoneDto(m.Id, m.Order, m.Title, m.DueOn, m.Status, m.InstallmentId, i?.Title, i?.DueOn, m.AcceptedOn, m.AcceptedByName, m.Note,
                tasks.Count(t => t.MilestoneId == m.Id && !t.Done), tasks.Count(t => t.MilestoneId == m.Id && t.Done));
        }).ToList();
    }

    private static async Task<Validation> ValidateAsync(UpsertMilestone r, Project p, Guid? selfId, ProjectsDbContext db, ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = new Validation().Required(r.Title, "title", "Tên mốc").MaxLength(r.Title, 200, "title", "Tên mốc").MaxLength(r.Note, 1000, "note", "Ghi chú");
        if (r.InstallmentId is { } iid)
        {
            var all = await ProjectEndpoints.InstallmentsOfAsync(db, sales, p.Id, ct);
            if (all.Count == 0 && !await db.ProjectContracts.AnyAsync(x => x.ProjectId == p.Id, ct)) v.Add("installmentId", "Dự án chưa gắn hợp đồng bán");
            else
            {
                var inst = all.FirstOrDefault(i => i.Id == iid);
                if (inst is null) v.Add("installmentId", "Đợt thu không thuộc hợp đồng của dự án");
                else if (inst.Cancelled) v.Add("installmentId", "Đợt thu đã huỷ");
                else if (await db.Milestones.AnyAsync(m => m.InstallmentId == iid && m.Id != selfId, ct)) v.Add("installmentId", "Đợt thu đã gắn với mốc khác");
            }
        }
        return v;
    }

    private static async Task<(Milestone? M, Project? P)> LoadAsync(Guid mid, ProjectsDbContext db, CancellationToken ct)
    {
        var m = await db.Milestones.FirstOrDefaultAsync(x => x.Id == mid, ct);
        return m is null ? (null, null) : (m, await db.Projects.FirstOrDefaultAsync(p => p.Id == m.ProjectId, ct));
    }

    private static async Task<Results<Created<Guid>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, UpsertMilestone r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        if (!v.CanManage(id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR được sửa mốc");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var val = await ValidateAsync(r, p, null, db, sales, ct);
        if (val.Failed) return val.Problem();
        var order = (await db.Milestones.Where(m => m.ProjectId == id).MaxAsync(m => (int?)m.Order, ct) ?? 0) + 1;
        var m = new Milestone { ProjectId = id, Order = order, Title = r.Title.Trim(), DueOn = r.DueOn, InstallmentId = r.InstallmentId, Note = ProjectEndpoints.Clean(r.Note) };
        db.Milestones.Add(m);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/projects/milestones/{m.Id}", m.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid mid, UpsertMilestone r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ISalesContractsLookup sales, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (m, p) = await LoadAsync(mid, db, ct);
        if (m is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanManage(p.Id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR được sửa mốc");
        if (m.Status == MilestoneStatus.Accepted && r.InstallmentId != m.InstallmentId) return Problems.Conflict("Mốc đã nghiệm thu, không đổi đợt thu");
        var val = await ValidateAsync(r, p, mid, db, sales, ct);
        if (val.Failed) return val.Problem();
        m.Title = r.Title.Trim(); m.DueOn = r.DueOn; m.InstallmentId = r.InstallmentId; m.Note = ProjectEndpoints.Clean(r.Note);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid mid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (m, p) = await LoadAsync(mid, db, ct);
        if (m is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanManage(p.Id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR được xoá mốc");
        if (m.Status == MilestoneStatus.Accepted) return Problems.Conflict("Mốc đã nghiệm thu, không xoá được");
        db.Milestones.Remove(m); // việc gắn mốc → MilestoneId = null (FK SetNull)
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> AcceptAsync(Guid mid, AcceptMilestone r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ISalesContractsLookup sales, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (m, p) = await LoadAsync(mid, db, ct);
        if (m is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanManage(p.Id)) return ProjectEndpoints.Forbidden("Chỉ quản lý dự án hoặc HR được nghiệm thu");
        if (m.Status == MilestoneStatus.Accepted) return Problems.Conflict("Mốc đã nghiệm thu");
        if (r.AcceptedOn > clock.Today) return new Validation().Add("acceptedOn", "Ngày nghiệm thu không ở tương lai").Problem();
        m.Status = MilestoneStatus.Accepted;
        m.AcceptedOn = r.AcceptedOn;
        m.AcceptedByName = v.Name;
        if (ProjectEndpoints.Clean(r.Note) is { } note) m.Note = note.Length > 1000 ? note[..1000] : note;
        await db.SaveChangesAsync(ct);
        if (m.InstallmentId is { } iid) await sales.MarkAcceptedAsync(iid, r.AcceptedOn, m.Title, $"{p.Code} · {p.Name}", ct);
        return TypedResults.NoContent();
    }
}
