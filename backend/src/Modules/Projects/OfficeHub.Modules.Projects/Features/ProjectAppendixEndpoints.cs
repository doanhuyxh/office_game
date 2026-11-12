using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

public sealed record AppendixCapabilityDto(string Key, string Label);
/// <param name="Allowed">Khoá quyền (trong <see cref="ProjectAppendixDto.Capabilities"/>) mà vai trò này có.</param>
public sealed record AppendixPersonaDto(string Key, string Label, string Who, List<string> Allowed);
public sealed record AppendixDepartmentDto(Guid Id, string Name, bool IsLead, int EmployeeCount);
public sealed record AppendixMemberDto(Guid EmployeeId, string? Code, string FullName, string? DepartmentName, ProjectMemberRole Role, bool IsBot, bool IsActive);
/// <param name="Personas">Quyền theo vai trò — sinh từ ProjectViewer, không viết cứng ở FE.</param>
public sealed record ProjectAppendixDto(List<AppendixCapabilityDto> Capabilities, List<AppendixPersonaDto> Personas,
    List<AppendixDepartmentDto> Departments, List<AppendixMemberDto> Members);

/// <summary>Tab "Phụ lục" (TEST-40): phòng ban tham gia, thành viên + quyền hạn từng vai trò. Ai xem được dự án đều xem được.</summary>
internal static class ProjectAppendixEndpoints
{
    public static void Map(RouteGroupBuilder g) => g.MapGet("/{id:guid}/appendix", GetAsync);

    private static async Task<Results<Ok<ProjectAppendixDto>, NotFound>> GetAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IEmployeeDirectory dir, IAccountService accounts, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.AsNoTracking().Include(x => x.Members).Include(x => x.Departments).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null || !v.CanSee(id)) return TypedResults.NotFound();
        var depts = (await dir.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        var active = await dir.ListActiveAsync(ct);
        var headcount = active.Where(e => e.DepartmentId is not null).GroupBy(e => e.DepartmentId!.Value).ToDictionary(g => g.Key, g => g.Count());
        var emps = await access.EmployeesAsync(ct);
        var userIds = p.Members.Select(m => emps.TryGetValue(m.EmployeeId, out var e) ? e.UserId : null).OfType<Guid>().ToList();
        var accs = await accounts.GetManyAsync(userIds, ct);
        var members = p.Members.Select(m =>
        {
            var e = emps.GetValueOrDefault(m.EmployeeId);
            return new AppendixMemberDto(m.EmployeeId, e?.Code, e?.FullName ?? "(không rõ)", e?.DepartmentName, m.Role,
                e?.UserId is { } u && accs.TryGetValue(u, out var a) && a.IsBot, e?.IsActive ?? false);
        }).OrderByDescending(m => m.Role).ThenBy(m => m.FullName, StringComparer.CurrentCulture).ToList();
        return TypedResults.Ok(new ProjectAppendixDto(
            ProjectPermissions.All.Select(c => new AppendixCapabilityDto(c.Key, c.Label)).ToList(),
            ProjectPermissions.Personas(id).Select(x => new AppendixPersonaDto(x.Key, x.Label, x.Who, ProjectPermissions.Allowed(x.Viewer, id))).ToList(),
            ProjectDepartmentRules.Ordered(p.Departments, d => d.IsLead, d => depts.GetValueOrDefault(d.DepartmentId, ""))
                .Select(d => new AppendixDepartmentDto(d.DepartmentId, depts.GetValueOrDefault(d.DepartmentId, "(phòng ban đã xoá)"), d.IsLead, headcount.GetValueOrDefault(d.DepartmentId)))
                .ToList(),
            members));
    }
}
