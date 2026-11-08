using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Features.Positions;

/// <param name="Level">Cấp bậc, 1 = cao nhất. Danh sách luôn sắp theo cấp rồi tên.</param>
public sealed record PositionDto(Guid Id, string Name, int Level, int SortOrder, int EmployeeCount, string? Description = null, bool HasGuide = false,
    bool SelfPublishDocuments = false, int FinancePermissions = 0, int DepartmentCount = 0);
/// <param name="SelfPublishDocuments">Tự ban hành tài liệu không cần duyệt — chỉ cấp 1–6 (Chuyên viên trở lên).</param>
/// <param name="FinancePermissions">Bit <see cref="FinancePermission"/>; <c>null</c> = giữ nguyên. Đổi giá trị chỉ admin / người có quyền Quản trị tài chính.</param>
public sealed record UpsertPositionRequest(string Name, int Level, int SortOrder = 0, bool SelfPublishDocuments = false, int? FinancePermissions = null);
/// <summary>Quyền tài chính của tài khoản đang đăng nhập (bit) + có được sửa quyền trên chức vụ không.</summary>
public sealed record MyFinanceAccess(int Permissions, bool CanManage);

internal static class PositionEndpoints
{
    public static void Map(RouteGroupBuilder org)
    {
        var g = org.MapGroup("/positions").WithTags("Organization");
        g.MapGet("/", ListAsync);
        g.MapGet("/my-finance", MyFinanceAsync);
        g.MapPost("/", CreateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPut("/{id:guid}", UpdateAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapDelete("/{id:guid}", DeleteAsync).RequireAuthorization(AuthPolicies.Hr);
    }

    private static async Task<Ok<List<PositionDto>>> ListAsync(OrgDbContext db, CancellationToken ct)
    {
        var counts = await db.Employees.Where(e => e.Status != EmployeeStatus.Resigned && e.PositionId != null)
            .GroupBy(e => e.PositionId!.Value).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        // Số phòng ban khác nhau của người giữ chức vụ — FE cảnh báo khi bật quyền tiền cho chức vụ dùng chung nhiều phòng.
        var deptCounts = await db.Employees.Where(e => e.Status != EmployeeStatus.Resigned && e.PositionId != null && e.DepartmentId != null)
            .GroupBy(e => e.PositionId!.Value).Select(g => new { g.Key, Count = g.Select(e => e.DepartmentId).Distinct().Count() })
            .ToDictionaryAsync(x => x.Key, x => x.Count, ct);
        var list = await db.Positions.AsNoTracking().OrderBy(p => p.Level).ThenBy(p => p.SortOrder).ThenBy(p => p.Name).ToListAsync(ct);
        return TypedResults.Ok(list.Select(p => new PositionDto(p.Id, p.Name, p.Level, p.SortOrder, counts.GetValueOrDefault(p.Id), p.Description, p.Guide != null,
            p.SelfPublishDocuments, p.FinancePermissions, deptCounts.GetValueOrDefault(p.Id))).ToList());
    }

    private static async Task<Ok<MyFinanceAccess>> MyFinanceAsync(ClaimsPrincipal user, IFinanceAccess access, CancellationToken ct)
    {
        var perm = user.GetUserId() is { } uid ? await access.GetAsync(uid, ct) : FinancePermission.None;
        return TypedResults.Ok(new MyFinanceAccess((int)perm, user.IsInRole(Roles.Admin) || perm.Has(FinancePermission.Admin)));
    }

    /// <summary>Chỉ admin hoặc người có quyền Quản trị tài chính mới được đổi quyền tài chính (HR thì không).</summary>
    private static async Task<bool> CanChangeFinanceAsync(ClaimsPrincipal user, IFinanceAccess access, CancellationToken ct) =>
        user.IsInRole(Roles.Admin) || (user.GetUserId() is { } uid && (await access.GetAsync(uid, ct)).Has(FinancePermission.Admin));

    private static async Task<Results<Created<Guid>, ValidationProblem, ProblemHttpResult>> CreateAsync(UpsertPositionRequest req, ClaimsPrincipal user, IFinanceAccess access,
        OrgDbContext db, CancellationToken ct)
    {
        var v = await ValidateAsync(req, null, db, ct);
        if (v.Failed) return v.Problem();
        var finance = req.FinancePermissions is { } f ? (int)FinancePermissions.Normalize(f) : 0;
        if (finance != 0 && !await CanChangeFinanceAsync(user, access, ct)) return FinanceForbidden();
        var p = new Position { Name = req.Name.Trim(), Level = req.Level, SortOrder = req.SortOrder, SelfPublishDocuments = req.SelfPublishDocuments, FinancePermissions = finance };
        db.Positions.Add(p);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/org/positions/{p.Id}", p.Id);
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, UpsertPositionRequest req, ClaimsPrincipal user,
        IFinanceAccess access, OrgDbContext db, CancellationToken ct)
    {
        var p = await db.Positions.FindAsync([id], ct);
        if (p is null) return TypedResults.NotFound();
        var v = await ValidateAsync(req, id, db, ct);
        if (v.Failed) return v.Problem();
        if (req.FinancePermissions is { } f && (int)FinancePermissions.Normalize(f) != p.FinancePermissions)
        {
            if (!await CanChangeFinanceAsync(user, access, ct)) return FinanceForbidden();
            p.FinancePermissions = (int)FinancePermissions.Normalize(f);
        }
        p.Name = req.Name.Trim();
        p.Level = req.Level;
        p.SortOrder = req.SortOrder;
        p.SelfPublishDocuments = req.SelfPublishDocuments;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid id, OrgDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var p = await db.Positions.FindAsync([id], ct);
        if (p is null) return TypedResults.NotFound();
        if (await db.Employees.AnyAsync(e => e.PositionId == id && e.Status != EmployeeStatus.Resigned, ct))
            return Problems.Conflict("Chức vụ đang có nhân viên, hãy đổi chức vụ cho họ trước");
        p.DeletedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static ProblemHttpResult FinanceForbidden() =>
        TypedResults.Problem("Chỉ quản trị viên hoặc người có quyền 'Quản trị tài chính' được đổi quyền tài chính của chức vụ", statusCode: StatusCodes.Status403Forbidden);

    private static async Task<Validation> ValidateAsync(UpsertPositionRequest r, Guid? selfId, OrgDbContext db, CancellationToken ct)
    {
        var v = new Validation().Required(r.Name, "name", "Tên chức vụ").MaxLength(r.Name, 150, "name", "Tên chức vụ")
            .When(r.FinancePermissions is { } fp && !FinancePermissions.IsValid(fp), "financePermissions", "Quyền tài chính không hợp lệ")
            .When(r.Level is < 1 or > PositionLadder.MaxLevel, "level", $"Cấp bậc phải từ 1 (cao nhất) đến {PositionLadder.MaxLevel}")
            .When(r.SelfPublishDocuments && !PositionLadder.CanSelfPublish(r.Level), "selfPublishDocuments",
                $"Chỉ chức vụ từ cấp Chuyên viên (cấp {PositionLadder.SpecialistLevel}) trở lên mới được tự ban hành tài liệu");
        if (!string.IsNullOrWhiteSpace(r.Name) && await db.Positions.AnyAsync(x => x.Name == r.Name.Trim() && x.Id != selfId, ct))
            v.Add("name", "Tên chức vụ đã tồn tại");
        return v;
    }
}
