using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <summary>Người theo dõi một việc (TEST-160). <paramref name="IsBot"/> = tài khoản bot (nhãn BOT).</summary>
public sealed record TaskFollowerDto(Guid EmployeeId, string? Code, string FullName, bool IsBot);

/// <summary>
/// Người theo dõi việc (TEST-160): thành viên dự án có quyền làm việc (kể cả token AI / MCP) thêm / bỏ người theo dõi; người được thêm phải là thành viên dự án.
/// Ghi lịch sử Follow / Unfollow (to / from = họ tên). Chưa gửi thông báo cho người theo dõi (đánh thức khi việc xong làm ở việc riêng).
/// </summary>
internal static class TaskFollowerEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/tasks/{tid:guid}/followers/{employeeId:guid}", AddAsync);
        g.MapDelete("/tasks/{tid:guid}/followers/{employeeId:guid}", RemoveAsync);
    }

    /// <summary>Người theo dõi của một việc (chi tiết việc), sắp theo họ tên; người không còn trong danh bạ → "(không rõ)".</summary>
    internal static async Task<List<TaskFollowerDto>> ListAsync(ProjectsDbContext db, ProjectAccess access, IAccountService accounts, Guid tid, CancellationToken ct)
    {
        var ids = await db.Followers.AsNoTracking().Where(f => f.TaskId == tid).OrderBy(f => f.CreatedAt).Select(f => f.EmployeeId).ToListAsync(ct);
        if (ids.Count == 0) return [];
        var emps = await access.EmployeesAsync(ct);
        var users = ids.Select(i => emps.TryGetValue(i, out var e) ? e.UserId : null).OfType<Guid>().Distinct().ToList();
        var accs = await accounts.GetManyAsync(users, ct);
        return ids.Select(i => emps.TryGetValue(i, out var e)
                ? new TaskFollowerDto(i, e.Code, e.FullName, e.UserId is { } u && accs.TryGetValue(u, out var a) && a.IsBot)
                : new TaskFollowerDto(i, null, "(không rõ)", false))
            .OrderBy(f => f.FullName, StringComparer.CurrentCulture).ToList();
    }

    private static async Task<Results<NoContent, NotFound, ValidationProblem, ProblemHttpResult>> AddAsync(Guid tid, Guid employeeId, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await TaskEndpoints.LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được sửa người theo dõi");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var already = await db.Followers.AnyAsync(f => f.TaskId == tid && f.EmployeeId == employeeId, ct);
        if (already) return TypedResults.NoContent();
        var count = await db.Followers.CountAsync(f => f.TaskId == tid, ct);
        if (FollowerRules.AddError(p.Members.Any(m => m.EmployeeId == employeeId), already, count) is { } err)
            return new Validation().Add("employeeId", err).Problem();
        if (await TaskEndpoints.StreakErrorAsync(user, tid, db, ct) is { } streakErr) return Problems.Conflict(streakErr);
        var now = clock.Now;
        db.Followers.Add(new TaskFollower { TaskId = tid, EmployeeId = employeeId, CreatedAt = now });
        db.Activities.Add(TaskEndpoints.Activity(t, TaskActivityKind.Follow, v, user, now, to: await NameAsync(access, employeeId, ct)));
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return TypedResults.NoContent(); } // hai người thêm cùng lúc → khoá chính trùng, coi như đã có
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> RemoveAsync(Guid tid, Guid employeeId, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var (t, p) = await TaskEndpoints.LoadAsync(tid, db, ct);
        if (t is null || p is null || !v.CanSee(p.Id)) return TypedResults.NotFound();
        if (!v.CanWork(p.Id)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được sửa người theo dõi");
        if (p.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        var row = await db.Followers.FirstOrDefaultAsync(f => f.TaskId == tid && f.EmployeeId == employeeId, ct);
        if (row is null) return TypedResults.NoContent();
        if (await TaskEndpoints.StreakErrorAsync(user, tid, db, ct) is { } streakErr) return Problems.Conflict(streakErr);
        db.Followers.Remove(row);
        db.Activities.Add(TaskEndpoints.Activity(t, TaskActivityKind.Unfollow, v, user, clock.Now, from: await NameAsync(access, employeeId, ct)));
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<string> NameAsync(ProjectAccess access, Guid employeeId, CancellationToken ct) =>
        (await access.EmployeesAsync(ct)).TryGetValue(employeeId, out var e) ? e.FullName : "(không rõ)";
}
