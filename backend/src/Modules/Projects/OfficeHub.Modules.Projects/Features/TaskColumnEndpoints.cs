using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="IsDone">Cột hoàn thành — việc ở đây tính là xong.</param>
/// <param name="ApproverOnly">Cần người duyệt — chỉ quản lý dự án / HR chuyển việc vào hoặc kéo lùi ra.</param>
/// <param name="WakeFollowers">"Đánh thức bot theo dõi" (TEST-178): việc vào đây → bot theo dõi việc được đánh thức.</param>
/// <param name="WakeBotIds">TEST-184: bot (Id nhân viên) được đánh thức; rỗng = mọi bot theo dõi việc, có giá trị = chỉ các bot này và phải đang theo dõi việc.</param>
/// <param name="HasGuide">TEST-186: cột có hướng dẫn đang hiệu lực (bật đánh thức + có nội dung).</param>
/// <param name="Guide">TEST-186: nội dung hướng dẫn đã lưu (cho web; còn giữ cả khi tắt đánh thức). MCP get_project / get_task bỏ trường này.</param>
public sealed record TaskColumnDto(Guid Id, string Name, int Position, string Color, bool IsDone, bool ApproverOnly, int TaskCount, bool WakeFollowers = false,
    IReadOnlyList<Guid>? WakeBotIds = null, bool HasGuide = false, string? Guide = null);
/// <param name="WakeFollowers">null (bỏ trống) = giữ nguyên khi sửa, false khi thêm.</param>
/// <param name="WakeBotIds">TEST-184: null (bỏ trống) = giữ nguyên khi sửa, rỗng = mọi bot theo dõi; mỗi Id phải là bot thành viên dự án (sai → 400).
/// Tắt <paramref name="WakeFollowers"/> → danh sách bị xoá.</param>
/// <param name="Guide">TEST-186: hướng dẫn cho bot ở cột (Markdown ≤ 10.000 ký tự). null (bỏ trống) = giữ nguyên khi sửa, "" = xoá;
/// có nội dung thì cột phải bật <paramref name="WakeFollowers"/> (400 <c>guide</c>).</param>
public sealed record UpsertTaskColumn(string Name, string? Color = null, bool IsDone = false, bool ApproverOnly = false, bool? WakeFollowers = null,
    List<Guid>? WakeBotIds = null, string? Guide = null);
public sealed record ReorderTaskColumns(List<Guid> Ids);

/// <summary>
/// Cột trạng thái công việc (chủ dự án chốt 2026-11-11): người giữ chức vụ có cờ "Quản lý trạng thái công việc" thêm / sửa / sắp xếp / xoá
/// ở mọi dự án họ xem được (vai trò admin / hr không thay thế). Dự án đã đóng → chỉ đọc. Token AI chỉ đọc (GET) — kể cả hướng dẫn cột
/// (TEST-186: bot không tự sửa hướng dẫn mình làm theo).
/// </summary>
internal static class TaskColumnEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/{id:guid}/columns", ListAsync);
        g.MapPost("/{id:guid}/columns", CreateAsync);
        g.MapPut("/{id:guid}/columns/order", ReorderAsync);
        g.MapPut("/columns/{cid:guid}", UpdateAsync);
        g.MapDelete("/columns/{cid:guid}", DeleteAsync);
    }

    internal static async Task<List<TaskColumn>> LoadAsync(ProjectsDbContext db, Guid projectId, CancellationToken ct) =>
        await db.Columns.Where(c => c.ProjectId == projectId).OrderBy(c => c.Position).ThenBy(c => c.Id).ToListAsync(ct);

    internal static List<ColumnInfo> Infos(IEnumerable<TaskColumn> cols) =>
        cols.OrderBy(c => c.Position).ThenBy(c => c.Id).Select(c => new ColumnInfo(c.Id, c.Name, c.Position, c.IsDone, c.ApproverOnly, c.WakeFollowers, c.WakeBotIds)).ToList();

    internal static async Task<List<TaskColumnDto>> ListForAsync(ProjectsDbContext db, Guid projectId, CancellationToken ct)
    {
        var cols = await db.Columns.AsNoTracking().Where(c => c.ProjectId == projectId).OrderBy(c => c.Position).ThenBy(c => c.Id).ToListAsync(ct);
        var counts = await db.Tasks.AsNoTracking().Where(t => t.ProjectId == projectId).GroupBy(t => t.ColumnId).Select(g => new { g.Key, N = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.N, ct);
        return cols.Select(c => new TaskColumnDto(c.Id, c.Name, c.Position, c.Color, c.IsDone, c.ApproverOnly, counts.GetValueOrDefault(c.Id), c.WakeFollowers,
            c.WakeBotIds, TaskColumnRules.ActiveGuide(c.WakeFollowers, c.Guide) is not null, c.Guide)).ToList();
    }

    private static async Task<Results<Ok<List<TaskColumnDto>>, NotFound>> ListAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id) || !await db.Projects.AnyAsync(p => p.Id == id, ct)) return TypedResults.NotFound();
        return TypedResults.Ok(await ListForAsync(db, id, ct));
    }

    /// <summary>Quyền + dự án còn chạy. Trả lỗi hoặc null.</summary>
    private static async Task<IResult?> GuardAsync(Guid projectId, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var status = await db.Projects.Where(p => p.Id == projectId).Select(p => (ProjectStatus?)p.Status).FirstOrDefaultAsync(ct);
        if (status is null || !v.CanSee(projectId)) return TypedResults.NotFound();
        if (user.IsAccessToken() || !v.CanManageColumns(projectId))
            return ProjectEndpoints.Forbidden("Cần chức vụ có quyền 'Quản lý trạng thái công việc'");
        return status != ProjectStatus.Active ? Problems.Conflict("Dự án đã đóng") : null;
    }

    private static Validation Validate(UpsertTaskColumn r, string name, List<ColumnInfo> infos, Guid? selfId)
    {
        var v = new Validation();
        if (TaskColumnRules.NameError(name, infos, selfId) is { } nameErr) v.Add("name", nameErr);
        if (r.Color is not null && !TaskColumnRules.IsValidColor(r.Color)) v.Add("color", "Màu phải dạng #rrggbb");
        return v;
    }

    /// <summary>Id nhân viên các thành viên dự án là tài khoản bot (kiểm tra <see cref="UpsertTaskColumn.WakeBotIds"/>, TEST-184).</summary>
    private static async Task<HashSet<Guid>> MemberBotIdsAsync(Guid projectId, ProjectsDbContext db, ProjectAccess access, IAccountService accounts, CancellationToken ct)
    {
        var members = await db.Members.AsNoTracking().Where(m => m.ProjectId == projectId).Select(m => m.EmployeeId).ToListAsync(ct);
        var emps = await access.EmployeesAsync(ct);
        var users = members.Select(m => emps.TryGetValue(m, out var e) && e.UserId is { } u ? (m, u) : ((Guid, Guid)?)null).OfType<(Guid Emp, Guid User)>().ToList();
        if (users.Count == 0) return [];
        var accs = await accounts.GetManyAsync(users.Select(x => x.User).ToList(), ct);
        return users.Where(x => accs.TryGetValue(x.User, out var a) && a.IsBot).Select(x => x.Emp).ToHashSet();
    }

    /// <summary>Danh sách bot hợp lệ của cột (null khi giữ nguyên) — thêm lỗi <c>wakeBotIds</c> vào <paramref name="val"/> nếu sai.</summary>
    private static async Task<List<Guid>?> BotIdsAsync(List<Guid>? requested, bool wake, Guid projectId, Validation val, ProjectsDbContext db, ProjectAccess access,
        IAccountService accounts, CancellationToken ct)
    {
        if (!wake) return [];
        if (requested is null) return null;
        var ids = FollowerWakeRules.NormalizeBotIds(requested, wake);
        if (ids.Count > 0 && FollowerWakeRules.BotIdsError(ids, await MemberBotIdsAsync(projectId, db, access, accounts, ct)) is { } botErr) val.Add("wakeBotIds", botErr);
        return ids;
    }

    private static async Task<IResult> CreateAsync(Guid id, UpsertTaskColumn r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, IAccountService accounts,
        CancellationToken ct)
    {
        if (await GuardAsync(id, user, db, access, ct) is { } err) return err;
        var cols = await LoadAsync(db, id, ct);
        if (TaskColumnRules.AddError(cols.Count) is { } addErr) return Problems.Conflict(addErr);
        var name = TaskColumnRules.NormalizeName(r.Name);
        var val = Validate(r, name, Infos(cols), null);
        var wake = r.WakeFollowers ?? false;
        var botIds = await BotIdsAsync(r.WakeBotIds, wake, id, val, db, access, accounts, ct) ?? [];
        if (TaskColumnRules.GuideError(r.Guide, wake) is { } guideErr) val.Add("guide", guideErr);
        if (val.Failed) return val.Problem();
        var c = new TaskColumn
        {
            ProjectId = id, Name = name, Position = cols.Count, IsDone = r.IsDone, ApproverOnly = r.ApproverOnly, WakeFollowers = wake, WakeBotIds = botIds,
            Guide = TaskColumnRules.CleanGuide(r.Guide),
            Color = r.Color?.ToLowerInvariant() ?? TaskColumnRules.Palette[cols.Count % TaskColumnRules.Palette.Length],
        };
        db.Columns.Add(c);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/projects/columns/{c.Id}", c.Id);
    }

    private static async Task<IResult> UpdateAsync(Guid cid, UpsertTaskColumn r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        IAccountService accounts, CancellationToken ct)
    {
        var c = await db.Columns.FirstOrDefaultAsync(x => x.Id == cid, ct);
        if (c is null) return TypedResults.NotFound();
        if (await GuardAsync(c.ProjectId, user, db, access, ct) is { } err) return err;
        var cols = await LoadAsync(db, c.ProjectId, ct);
        var infos = Infos(cols);
        var name = TaskColumnRules.NormalizeName(r.Name);
        var val = Validate(r, name, infos, cid);
        if (TaskColumnRules.UnsetDoneError(infos.First(x => x.Id == cid), r.IsDone, infos) is { } doneErr) val.Add("isDone", doneErr);
        var wake = r.WakeFollowers ?? c.WakeFollowers;
        var botIds = await BotIdsAsync(r.WakeBotIds, wake, c.ProjectId, val, db, access, accounts, ct);
        if (TaskColumnRules.GuideError(r.Guide, wake) is { } guideErr) val.Add("guide", guideErr);
        if (val.Failed) return val.Problem();
        if (r.IsDone != c.IsDone)
        {
            // Bật / tắt "hoàn thành" → việc trong cột thành xong / mở lại (đếm tiến độ, quá hạn, nhắc hạn theo CompletedAt).
            var now = clock.Now;
            foreach (var t in await db.Tasks.Where(t => t.ColumnId == cid).ToListAsync(ct)) t.CompletedAt = r.IsDone ? t.CompletedAt ?? now : null;
        }
        c.Name = name;
        if (r.Color is not null) c.Color = r.Color.ToLowerInvariant();
        c.IsDone = r.IsDone;
        c.ApproverOnly = r.ApproverOnly;
        c.WakeFollowers = wake;
        if (botIds is not null) c.WakeBotIds = botIds;
        if (r.Guide is not null) c.Guide = TaskColumnRules.CleanGuide(r.Guide); // "" → xoá; tắt đánh thức thì nội dung giữ nguyên (không dùng)
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<IResult> ReorderAsync(Guid id, ReorderTaskColumns r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await GuardAsync(id, user, db, access, ct) is { } err) return err;
        var cols = await LoadAsync(db, id, ct);
        if (!TaskColumnRules.IsPermutation(r.Ids ?? [], Infos(cols))) return Problems.Conflict("Danh sách trạng thái đã thay đổi — tải lại trang");
        var byId = cols.ToDictionary(c => c.Id);
        for (var i = 0; i < r.Ids!.Count; i++) byId[r.Ids[i]].Position = i;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Xoá cột; việc còn trong cột chuyển sang <paramref name="moveTo"/> (ghi lịch sử từng việc).</summary>
    private static async Task<IResult> DeleteAsync(Guid cid, Guid? moveTo, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        CancellationToken ct)
    {
        var c = await db.Columns.FirstOrDefaultAsync(x => x.Id == cid, ct);
        if (c is null) return TypedResults.NotFound();
        if (await GuardAsync(c.ProjectId, user, db, access, ct) is { } err) return err;
        var v = await access.ViewerAsync(user, ct);
        var cols = await LoadAsync(db, c.ProjectId, ct);
        await using var tx = await db.Database.BeginTransactionAsync(ct); // chuyển việc + xoá cột: cùng thành công hoặc cùng huỷ
        var tasks = await db.Tasks.Where(t => t.ColumnId == cid).OrderBy(t => t.Rank).ToListAsync(ct);
        if (TaskColumnRules.DeleteError(Infos(cols).First(x => x.Id == cid), Infos(cols), tasks.Count > 0, moveTo) is { } delErr) return Problems.Conflict(delErr);
        if (tasks.Count > 0)
        {
            var target = cols.First(x => x.Id == moveTo);
            var now = clock.Now;
            var rank = await db.Tasks.Where(t => t.ColumnId == target.Id).MaxAsync(t => (double?)t.Rank, ct) ?? 0;
            foreach (var t in tasks)
            {
                db.Activities.Add(new TaskActivity
                {
                    TaskId = t.Id, Kind = TaskActivityKind.Moved, From = c.Name, To = target.Name, Note = $"Xoá trạng thái \"{c.Name}\"",
                    ActorEmployeeId = v.Employee?.Id, ActorName = v.Name, At = now,
                });
                t.ColumnId = target.Id;
                t.Rank = ++rank;
                t.CompletedAt = target.IsDone ? t.CompletedAt ?? now : null;
            }
            await db.SaveChangesAsync(ct); // chuyển việc trước khi xoá cột (FK Restrict)
        }
        db.Columns.Remove(c);
        var pos = 0;
        foreach (var x in cols.Where(x => x.Id != cid)) x.Position = pos++;
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return TypedResults.NoContent();
    }
}
