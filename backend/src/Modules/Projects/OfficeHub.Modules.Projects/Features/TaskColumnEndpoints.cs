using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="IsDone">Cột hoàn thành — việc ở đây tính là xong.</param>
/// <param name="ApproverOnly">Cần người duyệt — chỉ quản lý dự án / HR chuyển việc vào hoặc kéo lùi ra.</param>
public sealed record TaskColumnDto(Guid Id, string Name, int Position, string Color, bool IsDone, bool ApproverOnly, int TaskCount);
public sealed record UpsertTaskColumn(string Name, string? Color = null, bool IsDone = false, bool ApproverOnly = false);
public sealed record ReorderTaskColumns(List<Guid> Ids);

/// <summary>
/// Cột trạng thái công việc (chủ dự án chốt 2026-11-11): người giữ chức vụ có cờ "Quản lý trạng thái công việc" thêm / sửa / sắp xếp / xoá
/// ở mọi dự án họ xem được (vai trò admin / hr không thay thế). Dự án đã đóng → chỉ đọc. Token AI chỉ đọc (GET).
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
        cols.OrderBy(c => c.Position).ThenBy(c => c.Id).Select(c => new ColumnInfo(c.Id, c.Name, c.Position, c.IsDone, c.ApproverOnly)).ToList();

    internal static async Task<List<TaskColumnDto>> ListForAsync(ProjectsDbContext db, Guid projectId, CancellationToken ct)
    {
        var cols = await db.Columns.AsNoTracking().Where(c => c.ProjectId == projectId).OrderBy(c => c.Position).ThenBy(c => c.Id).ToListAsync(ct);
        var counts = await db.Tasks.AsNoTracking().Where(t => t.ProjectId == projectId).GroupBy(t => t.ColumnId).Select(g => new { g.Key, N = g.Count() })
            .ToDictionaryAsync(x => x.Key, x => x.N, ct);
        return cols.Select(c => new TaskColumnDto(c.Id, c.Name, c.Position, c.Color, c.IsDone, c.ApproverOnly, counts.GetValueOrDefault(c.Id))).ToList();
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

    private static async Task<IResult> CreateAsync(Guid id, UpsertTaskColumn r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await GuardAsync(id, user, db, access, ct) is { } err) return err;
        var cols = await LoadAsync(db, id, ct);
        if (TaskColumnRules.AddError(cols.Count) is { } addErr) return Problems.Conflict(addErr);
        var name = TaskColumnRules.NormalizeName(r.Name);
        var val = Validate(r, name, Infos(cols), null);
        if (val.Failed) return val.Problem();
        var c = new TaskColumn
        {
            ProjectId = id, Name = name, Position = cols.Count, IsDone = r.IsDone, ApproverOnly = r.ApproverOnly,
            Color = r.Color?.ToLowerInvariant() ?? TaskColumnRules.Palette[cols.Count % TaskColumnRules.Palette.Length],
        };
        db.Columns.Add(c);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/projects/columns/{c.Id}", c.Id);
    }

    private static async Task<IResult> UpdateAsync(Guid cid, UpsertTaskColumn r, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        CancellationToken ct)
    {
        var c = await db.Columns.FirstOrDefaultAsync(x => x.Id == cid, ct);
        if (c is null) return TypedResults.NotFound();
        if (await GuardAsync(c.ProjectId, user, db, access, ct) is { } err) return err;
        var cols = await LoadAsync(db, c.ProjectId, ct);
        var infos = Infos(cols);
        var name = TaskColumnRules.NormalizeName(r.Name);
        var val = Validate(r, name, infos, cid);
        if (TaskColumnRules.UnsetDoneError(infos.First(x => x.Id == cid), r.IsDone, infos) is { } doneErr) val.Add("isDone", doneErr);
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
