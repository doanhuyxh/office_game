using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Departments;

public sealed record DepartmentDto(Guid Id, string Name, string? Code, Guid? ParentId, Guid? HeadEmployeeId, string? HeadName,
    string? MapZone, int SortOrder, int EmployeeCount, string? Description = null, bool HasGuide = false);

public sealed record UpsertDepartmentRequest(string Name, string? Code, Guid? ParentId, Guid? HeadEmployeeId, string? MapZone, int SortOrder = 0);

internal static class DepartmentEndpoints
{
    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/departments").WithTags("Organization");
        g.MapGet("/", ListAsync);
        g.MapPost("/", CreateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    private static async Task<Ok<List<DepartmentDto>>> ListAsync(OrgDbContext db, CancellationToken ct)
    {
        var counts = await db.Employees.Where(e => e.Status != EmployeeStatus.Resigned && e.DepartmentId != null)
            .GroupBy(e => e.DepartmentId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var list = await (
            from d in db.Departments.AsNoTracking()
            join h in db.Employees on d.HeadEmployeeId equals h.Id into hj
            from h in hj.DefaultIfEmpty()
            orderby d.SortOrder, d.Name
            select new { d, HeadName = h != null ? h.FullName : null }).ToListAsync(ct);
        return TypedResults.Ok(list.Select(x => new DepartmentDto(x.d.Id, x.d.Name, x.d.Code, x.d.ParentId, x.d.HeadEmployeeId, x.HeadName,
            x.d.MapZone, x.d.SortOrder, counts.GetValueOrDefault(x.d.Id), x.d.Description, x.d.Guide != null)).ToList());
    }

    private static async Task<Results<Created<Guid>, ValidationProblem>> CreateAsync(UpsertDepartmentRequest req, OrgDbContext db, CancellationToken ct)
    {
        var v = await ValidateAsync(req, null, db, ct);
        if (v.Failed) return v.Problem();
        var d = new Department { Name = req.Name.Trim() };
        Apply(d, req);
        db.Departments.Add(d);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/org/departments/{d.Id}", d.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem>> UpdateAsync(Guid id, UpsertDepartmentRequest req, OrgDbContext db, CancellationToken ct)
    {
        var d = await db.Departments.FindAsync([id], ct);
        if (d is null) return TypedResults.NotFound();
        var v = await ValidateAsync(req, id, db, ct);
        if (v.Failed) return v.Problem();
        Apply(d, req);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid id, OrgDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var d = await db.Departments.FindAsync([id], ct);
        if (d is null) return TypedResults.NotFound();
        if (await db.Departments.AnyAsync(x => x.ParentId == id, ct))
            return Problems.Conflict("Phòng ban còn phòng ban con, hãy chuyển hoặc xoá phòng ban con trước");
        if (await db.Employees.AnyAsync(e => e.DepartmentId == id && e.Status != EmployeeStatus.Resigned, ct))
            return Problems.Conflict("Phòng ban còn nhân viên, hãy chuyển nhân viên sang phòng ban khác trước");
        d.DeletedAt = clock.GetUtcNow(); // xoá mềm
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static void Apply(Department d, UpsertDepartmentRequest r)
    {
        d.Name = r.Name.Trim();
        d.Code = string.IsNullOrWhiteSpace(r.Code) ? null : r.Code.Trim();
        d.ParentId = r.ParentId;
        d.HeadEmployeeId = r.HeadEmployeeId;
        d.MapZone = string.IsNullOrWhiteSpace(r.MapZone) ? null : r.MapZone.Trim();
        d.SortOrder = r.SortOrder;
    }

    private static async Task<Validation> ValidateAsync(UpsertDepartmentRequest r, Guid? selfId, OrgDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Name, "name", "Tên phòng ban").MaxLength(r.Name, 150, "name", "Tên phòng ban");
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.Departments.AnyAsync(x => x.Name == r.Name.Trim() && x.Id != selfId, ct))
            v.Add("name", "Tên phòng ban đã tồn tại");
        if (r.ParentId is { } pid)
        {
            if (pid == selfId) v.Add("parentId", "Phòng ban cha không được là chính nó");
            else if (!await db.Departments.AnyAsync(x => x.Id == pid, ct)) v.Add("parentId", "Phòng ban cha không tồn tại");
            else if (selfId is { } sid && await IsDescendantAsync(pid, sid, db, ct)) v.Add("parentId", "Không được chọn phòng ban con làm phòng ban cha");
        }
        if (r.HeadEmployeeId is { } hid && !await db.Employees.AnyAsync(e => e.Id == hid && e.Status != EmployeeStatus.Resigned, ct))
            v.Add("headEmployeeId", "Trưởng phòng không tồn tại hoặc đã nghỉ việc");
        return v;
    }

    /// <summary>candidate có nằm trong cây con của root không (chống vòng lặp cha-con).</summary>
    private static async Task<bool> IsDescendantAsync(Guid candidate, Guid root, OrgDbContext db, CancellationToken ct)
    {
        var parents = await db.Departments.AsNoTracking().ToDictionaryAsync(x => x.Id, x => x.ParentId, ct);
        for (Guid? cur = candidate; cur is { } c; cur = parents.GetValueOrDefault(c))
            if (c == root) return true;
        return false;
    }
}
