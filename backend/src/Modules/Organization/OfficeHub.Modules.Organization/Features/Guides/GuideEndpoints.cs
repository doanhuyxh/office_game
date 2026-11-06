using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Guides;

public sealed record GuideDto(string? Description, string? Guide, DateTimeOffset? GuideUpdatedAt, string? GuideUpdatedByName);
public sealed record DepartmentDetailDto(Guid Id, string Name, string? Code, Guid? ParentId, string? ParentName, Guid? HeadEmployeeId, string? HeadName,
    int EmployeeCount, GuideDto Guide, bool CanEditGuide);
public sealed record PositionDetailDto(Guid Id, string Name, int Level, int EmployeeCount, GuideDto Guide, bool CanEditGuide);
public sealed record SaveGuideRequest(string? Description, string? Guide);

public sealed record RolePersonDto(Guid Id, string Code, string FullName, string? JobTitle, string? PositionName);
public sealed record RoleDepartmentDto(Guid Id, string Name, string? Code, string? HeadName, bool IsHead, string? Description, string? Guide);
public sealed record RolePositionDto(Guid Id, string Name, int Level, string? Description, string? Guide);
/// <summary>
/// Vai trò của người đang đăng nhập — dữ liệu cho thẻ "Vai trò của tôi" và tool MCP get_my_role (cùng một nội dung).
/// Departments: phòng của mình trước, rồi các phòng cha tới gốc.
/// </summary>
public sealed record MyRoleDto(RolePersonDto Me, RolePositionDto? Position, IReadOnlyList<RoleDepartmentDto> Departments,
    RolePersonDto? Manager, IReadOnlyList<string> HeadOf);

/// <summary>
/// Mô tả + hướng dẫn của phòng ban / chức vụ (mọi nhân viên và trợ lý AI đọc được). Sửa: HR; hướng dẫn phòng ban thì thêm trưởng phòng đó.
/// Chức vụ chỉ HR sửa. Mọi lần sửa ghi vào lịch sử ([Audited]).
/// </summary>
internal static class GuideEndpoints
{
    public static void Map(RouteGroupBuilder org)
    {
        var d = org.MapGroup("/departments").WithTags("Organization");
        d.MapGet("/{id:guid}", DepartmentAsync);
        d.MapPut("/{id:guid}/guide", SaveDepartmentGuideAsync); // HR hoặc trưởng phòng đó — kiểm tra trong handler
        var p = org.MapGroup("/positions").WithTags("Organization");
        p.MapGet("/{id:guid}", PositionAsync);
        p.MapPut("/{id:guid}/guide", SavePositionGuideAsync).RequireAuthorization(AuthPolicies.Hr);
        org.MapGet("/employees/me/role", MyRoleAsync).WithTags("Organization");
        org.MapGet("/guide-templates", () => TypedResults.Ok(new { department = OrgGuide.DepartmentTemplate, position = OrgGuide.PositionTemplate })).WithTags("Organization");
    }

    private static GuideDto Guide(Department d) => new(d.Description, d.Guide, d.GuideUpdatedAt, d.GuideUpdatedByName);
    private static GuideDto Guide(Position p) => new(p.Description, p.Guide, p.GuideUpdatedAt, p.GuideUpdatedByName);

    private static Task<Guid?> MyEmployeeIdAsync(ClaimsPrincipal user, OrgDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId();
        return db.Employees.Where(e => e.UserId == uid && e.Status != EmployeeStatus.Resigned).Select(e => (Guid?)e.Id).FirstOrDefaultAsync(ct);
    }

    private static async Task<bool> CanEditDepartmentAsync(Department d, ClaimsPrincipal user, OrgDbContext db, CancellationToken ct) =>
        user.IsHr() || (d.HeadEmployeeId is { } head && await MyEmployeeIdAsync(user, db, ct) == head);

    private static Validation ValidateGuide(SaveGuideRequest r) => new Validation()
        .MaxLength(r.Description, OrgGuide.DescriptionMax, "description", "Mô tả")
        .MaxLength(r.Guide, OrgGuide.GuideMax, "guide", "Hướng dẫn");

    private static async Task<Results<Ok<DepartmentDetailDto>, NotFound>> DepartmentAsync(Guid id, ClaimsPrincipal user, OrgDbContext db, CancellationToken ct)
    {
        var d = await db.Departments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return TypedResults.NotFound();
        var parent = d.ParentId is { } pid ? await db.Departments.Where(x => x.Id == pid).Select(x => x.Name).FirstOrDefaultAsync(ct) : null;
        var head = d.HeadEmployeeId is { } hid ? await db.Employees.Where(x => x.Id == hid).Select(x => x.FullName).FirstOrDefaultAsync(ct) : null;
        var count = await db.Employees.CountAsync(e => e.DepartmentId == id && e.Status != EmployeeStatus.Resigned, ct);
        return TypedResults.Ok(new DepartmentDetailDto(d.Id, d.Name, d.Code, d.ParentId, parent, d.HeadEmployeeId, head, count, Guide(d),
            await CanEditDepartmentAsync(d, user, db, ct)));
    }

    private static async Task<Results<Ok<GuideDto>, NotFound, ForbidHttpResult, ValidationProblem>> SaveDepartmentGuideAsync(
        Guid id, SaveGuideRequest req, ClaimsPrincipal user, OrgDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var d = await db.Departments.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (d is null) return TypedResults.NotFound();
        if (!await CanEditDepartmentAsync(d, user, db, ct)) return TypedResults.Forbid();
        var v = ValidateGuide(req);
        if (v.Failed) return v.Problem();
        d.Description = OrgGuide.Clean(req.Description);
        d.Guide = OrgGuide.Clean(req.Guide);
        d.GuideUpdatedAt = clock.GetUtcNow();
        d.GuideUpdatedByName = user.FindFirstValue(ClaimNames.FullName);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(Guide(d));
    }

    private static async Task<Results<Ok<PositionDetailDto>, NotFound>> PositionAsync(Guid id, ClaimsPrincipal user, OrgDbContext db, CancellationToken ct)
    {
        var p = await db.Positions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        var count = await db.Employees.CountAsync(e => e.PositionId == id && e.Status != EmployeeStatus.Resigned, ct);
        return TypedResults.Ok(new PositionDetailDto(p.Id, p.Name, p.Level, count, Guide(p), user.IsHr()));
    }

    private static async Task<Results<Ok<GuideDto>, NotFound, ValidationProblem>> SavePositionGuideAsync(
        Guid id, SaveGuideRequest req, ClaimsPrincipal user, OrgDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var p = await db.Positions.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return TypedResults.NotFound();
        var v = ValidateGuide(req);
        if (v.Failed) return v.Problem();
        p.Description = OrgGuide.Clean(req.Description);
        p.Guide = OrgGuide.Clean(req.Guide);
        p.GuideUpdatedAt = clock.GetUtcNow();
        p.GuideUpdatedByName = user.FindFirstValue(ClaimNames.FullName);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(Guide(p));
    }

    /// <summary>404 (title no_employee_profile) nếu tài khoản chưa gắn hồ sơ nhân viên.</summary>
    private static async Task<Results<Ok<MyRoleDto>, ProblemHttpResult>> MyRoleAsync(ClaimsPrincipal user, OrgDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId();
        var e = await db.Employees.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == uid, ct);
        if (e is null)
            return TypedResults.Problem("Tài khoản chưa gắn hồ sơ nhân viên", statusCode: StatusCodes.Status404NotFound, title: "no_employee_profile");

        var depts = await db.Departments.AsNoTracking().ToDictionaryAsync(d => d.Id, ct);
        var positions = await db.Positions.IgnoreQueryFilters().AsNoTracking().ToDictionaryAsync(p => p.Id, ct);
        var headIds = depts.Values.Where(d => d.HeadEmployeeId != null).Select(d => d.HeadEmployeeId!.Value).Distinct().ToList();
        var heads = await db.Employees.AsNoTracking().Where(x => headIds.Contains(x.Id)).ToDictionaryAsync(x => x.Id, x => x.FullName, ct);
        var manager = e.ManagerId is { } mid ? await db.Employees.AsNoTracking().FirstOrDefaultAsync(x => x.Id == mid, ct) : null;

        RolePersonDto Person(Employee x) => new(x.Id, x.Code, x.FullName, x.JobTitle,
            x.PositionId is { } p && positions.TryGetValue(p, out var pos) ? pos.Name : null);

        var chain = OrgGuide.Chain(depts, e.DepartmentId, d => d.ParentId)
            .Select(d => new RoleDepartmentDto(d.Id, d.Name, d.Code, d.HeadEmployeeId is { } h ? heads.GetValueOrDefault(h) : null,
                d.HeadEmployeeId == e.Id, d.Description, d.Guide))
            .ToList();
        var position = e.PositionId is { } pid && positions.TryGetValue(pid, out var ps)
            ? new RolePositionDto(ps.Id, ps.Name, ps.Level, ps.Description, ps.Guide) : null;
        var headOf = depts.Values.Where(d => d.HeadEmployeeId == e.Id).Select(d => d.Name).OrderBy(n => n).ToList();
        return TypedResults.Ok(new MyRoleDto(Person(e), position, chain, manager is null ? null : Person(manager), headOf));
    }
}
