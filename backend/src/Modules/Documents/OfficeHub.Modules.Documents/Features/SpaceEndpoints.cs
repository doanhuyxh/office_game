using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Documents.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Documents.Features;

/// <summary>Kho (công ty / phòng ban / dự án), dự án + thành viên, thư mục.</summary>
internal static class SpaceEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/spaces", SpacesAsync);

        g.MapGet("/projects", ProjectsAsync);
        g.MapPost("/projects", CreateProjectAsync);
        g.MapPut("/projects/{id:guid}", UpdateProjectAsync);
        g.MapDelete("/projects/{id:guid}", DeleteProjectAsync).RequireAuthorization(AuthPolicies.Hr);
        g.MapPost("/projects/{id:guid}/members", AddMembersAsync);
        g.MapDelete("/projects/{id:guid}/members/{employeeId:guid}", RemoveMemberAsync);

        g.MapGet("/folders", FoldersAsync);
        g.MapPost("/folders", CreateFolderAsync);
        g.MapPost("/folders/ensure", EnsureFolderAsync);
        g.MapPut("/folders/{id:guid}", RenameFolderAsync);
        g.MapDelete("/folders/{id:guid}", DeleteFolderAsync);
    }

    // ---------------- Kho ----------------

    /// <summary>Các kho người gọi vào được: công ty, phòng ban (HR: tất cả), dự án (HR: tất cả, người khác: dự án mình là thành viên).</summary>
    private static async Task<Ok<List<SpaceDto>>> SpacesAsync(ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var list = new List<SpaceDto> { new(SpaceKind.Company, null, "Công ty", DocumentRules.CompanySpaceCode, null, true, v.IsHr, false) };
        foreach (var d in await access.DepartmentsAsync(ct))
            if (DocumentAccess.CanRead(v, SpaceKind.Department, d.Id))
                list.Add(new(SpaceKind.Department, d.Id, d.Name, DocumentRules.SpaceCode(SpaceKind.Department, d.Code), d.ParentId, true,
                    DocumentAccess.CanManage(v, SpaceKind.Department, d.Id), false));
        var projects = await db.Projects.AsNoTracking().OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct);
        foreach (var p in projects.Where(p => DocumentAccess.CanRead(v, SpaceKind.Project, p.Id)))
            list.Add(new(SpaceKind.Project, p.Id, p.Name, DocumentRules.SpaceCode(SpaceKind.Project, p.Code), null, p.Status == ProjectStatus.Active,
                DocumentAccess.CanManage(v, SpaceKind.Project, p.Id), p.Status == ProjectStatus.Closed));
        return TypedResults.Ok(list);
    }

    // ---------------- Dự án ----------------

    private static async Task<Ok<List<ProjectDto>>> ProjectsAsync(ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var q = db.Projects.AsNoTracking().Include(p => p.Members).AsQueryable();
        if (!v.IsHr)
        {
            var mine = v.Projects.Keys.ToList();
            q = q.Where(p => mine.Contains(p.Id));
        }
        var projects = await q.OrderBy(p => p.Status).ThenBy(p => p.Name).ToListAsync(ct);
        var ids = projects.Select(p => (Guid?)p.Id).ToList();
        var counts = await db.Assets.Where(a => a.SpaceKind == SpaceKind.Project && ids.Contains(a.SpaceId) && a.DeletedAt == null)
            .GroupBy(a => a.SpaceId).Select(x => new { x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key!.Value, x => x.Count, ct);
        var people = await People.LoadAsync(dir, projects.SelectMany(p => p.Members.Select(m => m.EmployeeId)), ct);
        var depts = (await access.DepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        return TypedResults.Ok(projects.Select(p => ToDto(p, v, people, depts, counts.GetValueOrDefault(p.Id))).ToList());
    }

    private static ProjectDto ToDto(Project p, Viewer v, IReadOnlyDictionary<Guid, EmployeeRef> people, IReadOnlyDictionary<Guid, string> depts, int count) =>
        new(p.Id, p.Code, p.Name, p.Description, p.Status, p.DepartmentId, p.DepartmentId is { } d ? depts.GetValueOrDefault(d) : null,
            p.Members.OrderByDescending(m => m.Role).ThenBy(m => people.GetValueOrDefault(m.EmployeeId)?.FullName)
                .Select(m => people.GetValueOrDefault(m.EmployeeId) is { } e
                    ? new ProjectMemberDto(m.EmployeeId, e.Code, e.FullName, m.Role, e.IsActive)
                    : new ProjectMemberDto(m.EmployeeId, null, "(không rõ)", m.Role, false)).ToList(),
            v.Projects.TryGetValue(p.Id, out var r) ? r : null, DocumentAccess.CanManage(v, SpaceKind.Project, p.Id), count, p.CreatedAt);

    /// <summary>Quản lý (manager) / HR / admin tạo dự án; người tạo (có hồ sơ) thành quản lý dự án.</summary>
    private static async Task<Results<Ok<ProjectDto>, ValidationProblem, ProblemHttpResult>> CreateProjectAsync(CreateProjectRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, IEmployeeDirectory dir, INotifier notifier, DocClock clock, CancellationToken ct)
    {
        if (!user.IsHr() && !user.IsInRole(Roles.Manager)) return Http.Forbidden("Chỉ quản lý hoặc HR được tạo dự án");
        var v = await access.ViewerAsync(user, ct);
        var code = req.Code?.Trim().ToUpperInvariant();
        var val = new Validation().Required(code, "code", "Mã dự án").MaxLength(code, 30, "code", "Mã dự án")
            .Required(req.Name, "name", "Tên dự án").MaxLength(req.Name?.Trim(), 200, "name", "Tên dự án")
            .MaxLength(req.Description, 2000, "description", "Mô tả");
        if (!val.Has("code") && await db.Projects.AnyAsync(p => p.Code == code, ct)) val.Add("code", "Mã dự án đã tồn tại");
        if (req.DepartmentId is { } dep && (await access.DepartmentsAsync(ct)).All(d => d.Id != dep)) val.Add("departmentId", "Phòng ban không tồn tại");
        if (val.Failed) return val.Problem();

        var now = clock.Now;
        var p = new Project { Code = code!, Name = req.Name!.Trim(), Description = Blank(req.Description), DepartmentId = req.DepartmentId,
            CreatedAt = now, CreatedByName = v.Name };
        if (v.Employee is { } me) p.Members.Add(new ProjectMember { EmployeeId = me.Id, Role = ProjectRole.Manager, AddedAt = now });
        var added = new List<EmployeeRef>();
        foreach (var id in (req.MemberIds ?? []).Distinct().Where(id => p.Members.All(m => m.EmployeeId != id)))
            if (await dir.GetAsync(id, ct) is { IsActive: true } e)
            {
                p.Members.Add(new ProjectMember { EmployeeId = id, Role = ProjectRole.Member, AddedAt = now });
                added.Add(e);
            }
        db.Projects.Add(p);
        await db.SaveChangesAsync(ct);
        await NotifyAddedAsync(notifier, added, p, v, ct);
        var vAfter = v with { Projects = new Dictionary<Guid, ProjectRole>(v.Projects) { [p.Id] = ProjectRole.Manager } };
        var people = await People.LoadAsync(dir, p.Members.Select(m => m.EmployeeId), ct);
        var depts = (await access.DepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.Name);
        return TypedResults.Ok(ToDto(p, v.Employee is null ? v : vAfter, people, depts, 0));
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> UpdateProjectAsync(Guid id, UpdateProjectRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return Problems.NotFound("dự án");
        if (!DocumentAccess.CanManage(v, SpaceKind.Project, id)) return Http.Forbidden("Chỉ quản lý dự án hoặc HR được sửa dự án");
        var val = new Validation().Required(req.Name, "name", "Tên dự án").MaxLength(req.Name?.Trim(), 200, "name", "Tên dự án")
            .MaxLength(req.Description, 2000, "description", "Mô tả");
        if (req.DepartmentId is { } dep && (await access.DepartmentsAsync(ct)).All(d => d.Id != dep)) val.Add("departmentId", "Phòng ban không tồn tại");
        if (val.Failed) return val.Problem();
        p.Name = req.Name!.Trim();
        p.Description = Blank(req.Description);
        p.DepartmentId = req.DepartmentId;
        p.Status = req.Status;
        p.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>HR xoá dự án chưa có tài liệu nào (kể cả trong thùng rác) — có tài liệu thì đóng dự án thay vì xoá.</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteProjectAsync(Guid id, DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var p = await db.Projects.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return Problems.NotFound("dự án");
        if (await db.Assets.AnyAsync(a => a.SpaceKind == SpaceKind.Project && a.SpaceId == id, ct))
            return Problems.Conflict("Dự án đã có tài liệu — hãy đóng dự án (chỉ đọc) thay vì xoá");
        p.DeletedAt = clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> AddMembersAsync(Guid id, AddMembersRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, IEmployeeDirectory dir, INotifier notifier, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return Problems.NotFound("dự án");
        if (!DocumentAccess.CanManage(v, SpaceKind.Project, id)) return Http.Forbidden("Chỉ quản lý dự án hoặc HR được đổi thành viên");
        if (req.EmployeeIds is not { Count: > 0 }) return new Validation().Add("employeeIds", "Chọn ít nhất một nhân viên").Problem();
        var added = new List<EmployeeRef>();
        foreach (var eid in req.EmployeeIds.Distinct())
        {
            if (p.Members.FirstOrDefault(m => m.EmployeeId == eid) is { } existing) { existing.Role = req.Role; continue; }
            if (await dir.GetAsync(eid, ct) is not { IsActive: true } e) continue;
            p.Members.Add(new ProjectMember { EmployeeId = eid, Role = req.Role, AddedAt = clock.Now });
            added.Add(e);
        }
        await db.SaveChangesAsync(ct);
        await NotifyAddedAsync(notifier, added, p, v, ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> RemoveMemberAsync(Guid id, Guid employeeId, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var p = await db.Projects.Include(x => x.Members).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return Problems.NotFound("dự án");
        if (!DocumentAccess.CanManage(v, SpaceKind.Project, id)) return Http.Forbidden("Chỉ quản lý dự án hoặc HR được đổi thành viên");
        var m = p.Members.FirstOrDefault(x => x.EmployeeId == employeeId);
        if (m is null) return TypedResults.NoContent();
        if (m.Role == ProjectRole.Manager && p.Members.Count(x => x.Role == ProjectRole.Manager) == 1)
            return Problems.Conflict("Dự án phải còn ít nhất một quản lý");
        p.Members.Remove(m);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task NotifyAddedAsync(INotifier notifier, List<EmployeeRef> added, Project p, Viewer v, CancellationToken ct)
    {
        var to = added.Where(e => e.UserId is { } u && u != v.UserId).Select(e => e.UserId!.Value).ToList();
        if (to.Count == 0) return;
        await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.ProjectMemberAdded,
            $"Bạn được thêm vào dự án {p.Code} · {p.Name}", $"{v.Name} đã thêm bạn vào dự án. Kho tài liệu dự án đã mở cho bạn.",
            $"/documents?space=Project:{p.Id}", SendEmail: false), ct);
    }

    // ---------------- Thư mục ----------------

    private static async Task<Results<Ok<List<FolderDto>>, ProblemHttpResult>> FoldersAsync(SpaceKind spaceKind, Guid? spaceId, ClaimsPrincipal user,
        DocumentAccess access, DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!DocumentAccess.CanRead(v, spaceKind, spaceId)) return Http.Forbidden();
        var folders = await db.Folders.AsNoTracking().Where(f => f.SpaceKind == spaceKind && f.SpaceId == spaceId).OrderBy(f => f.Name).ToListAsync(ct);
        var counts = await db.Assets.Where(a => a.SpaceKind == spaceKind && a.SpaceId == spaceId && a.DeletedAt == null && a.FolderId != null)
            .GroupBy(a => a.FolderId).Select(x => new { x.Key, Count = x.Count() }).ToDictionaryAsync(x => x.Key!.Value, x => x.Count, ct);
        return TypedResults.Ok(folders.Select(f => new FolderDto(f.Id, f.ParentId, f.Name, counts.GetValueOrDefault(f.Id))).ToList());
    }

    private static async Task<Results<Ok<FolderDto>, ValidationProblem, ProblemHttpResult>> CreateFolderAsync(CreateFolderRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (await access.SpaceAsync(req.SpaceKind, req.SpaceId, ct) is null) return Problems.NotFound("kho tài liệu");
        if (!await access.CanWriteAsync(v, req.SpaceKind, req.SpaceId, ct)) return Http.Forbidden();
        if (DocumentRules.FolderNameError(req.Name) is { } err) return new Validation().Add("name", err).Problem();
        if (req.ParentId is { } pid && !await db.Folders.AnyAsync(f => f.Id == pid && f.SpaceKind == req.SpaceKind && f.SpaceId == req.SpaceId, ct))
            return Problems.NotFound("thư mục cha");
        var name = req.Name!.Trim();
        if (await db.Folders.AnyAsync(f => f.SpaceKind == req.SpaceKind && f.SpaceId == req.SpaceId && f.ParentId == req.ParentId && f.Name == name, ct))
            return new Validation().Add("name", "Đã có thư mục cùng tên ở đây").Problem();
        var f = new Folder { SpaceKind = req.SpaceKind, SpaceId = req.SpaceId, ParentId = req.ParentId, Name = name, CreatedByUserId = v.UserId, CreatedAt = clock.Now };
        db.Folders.Add(f);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new FolderDto(f.Id, f.ParentId, f.Name, 0));
    }

    /// <summary>Đảm bảo có chuỗi thư mục "a/b/c" (tạo phần còn thiếu) — FE gọi tuần tự cho từng thư mục khi nhập cả thư mục từ máy.</summary>
    private static async Task<Results<Ok<FolderDto>, ValidationProblem, ProblemHttpResult>> EnsureFolderAsync(EnsureFolderRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, DocClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (await access.SpaceAsync(req.SpaceKind, req.SpaceId, ct) is null) return Problems.NotFound("kho tài liệu");
        if (!await access.CanWriteAsync(v, req.SpaceKind, req.SpaceId, ct)) return Http.Forbidden();
        var parts = (req.Path ?? "").Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0 || parts.Length > 20) return new Validation().Add("path", "Đường dẫn thư mục không hợp lệ").Problem();
        foreach (var part in parts)
            if (DocumentRules.FolderNameError(part) is { } err) return new Validation().Add("path", $"{part}: {err}").Problem();
        if (req.ParentId is { } pid && !await db.Folders.AnyAsync(f => f.Id == pid && f.SpaceKind == req.SpaceKind && f.SpaceId == req.SpaceId, ct))
            return Problems.NotFound("thư mục cha");

        Folder? current = null;
        var parent = req.ParentId;
        foreach (var part in parts)
        {
            current = await db.Folders.FirstOrDefaultAsync(f => f.SpaceKind == req.SpaceKind && f.SpaceId == req.SpaceId && f.ParentId == parent && f.Name == part, ct);
            if (current is null)
            {
                current = new Folder { SpaceKind = req.SpaceKind, SpaceId = req.SpaceId, ParentId = parent, Name = part, CreatedByUserId = v.UserId, CreatedAt = clock.Now };
                db.Folders.Add(current);
                try { await db.SaveChangesAsync(ct); }
                catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
                {
                    db.Entry(current).State = EntityState.Detached; // request khác vừa tạo cùng thư mục → dùng thư mục đó
                    current = await db.Folders.FirstAsync(f => f.SpaceKind == req.SpaceKind && f.SpaceId == req.SpaceId && f.ParentId == parent && f.Name == part, ct);
                }
            }
            parent = current.Id;
        }
        return TypedResults.Ok(new FolderDto(current!.Id, current.ParentId, current.Name, 0));
    }

    private static async Task<Results<NoContent, ValidationProblem, ProblemHttpResult>> RenameFolderAsync(Guid id, RenameFolderRequest req,
        ClaimsPrincipal user, DocumentAccess access, DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var f = await db.Folders.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (f is null) return Problems.NotFound("thư mục");
        if (!await access.CanWriteAsync(v, f.SpaceKind, f.SpaceId, ct) || (f.CreatedByUserId != v.UserId && !DocumentAccess.CanManage(v, f.SpaceKind, f.SpaceId)))
            return Http.Forbidden("Chỉ người tạo thư mục hoặc người quản lý kho được đổi tên");
        if (DocumentRules.FolderNameError(req.Name) is { } err) return new Validation().Add("name", err).Problem();
        var name = req.Name!.Trim();
        if (await db.Folders.AnyAsync(x => x.Id != id && x.SpaceKind == f.SpaceKind && x.SpaceId == f.SpaceId && x.ParentId == f.ParentId && x.Name == name, ct))
            return new Validation().Add("name", "Đã có thư mục cùng tên ở đây").Problem();
        f.Name = name;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    /// <summary>Chỉ xoá thư mục trống (không thư mục con, không tài liệu — kể cả trong thùng rác).</summary>
    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteFolderAsync(Guid id, ClaimsPrincipal user, DocumentAccess access,
        DocumentsDbContext db, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var f = await db.Folders.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (f is null) return Problems.NotFound("thư mục");
        if (!await access.CanWriteAsync(v, f.SpaceKind, f.SpaceId, ct) || (f.CreatedByUserId != v.UserId && !DocumentAccess.CanManage(v, f.SpaceKind, f.SpaceId)))
            return Http.Forbidden("Chỉ người tạo thư mục hoặc người quản lý kho được xoá");
        if (await db.Folders.AnyAsync(x => x.ParentId == id, ct) || await db.Assets.AnyAsync(a => a.FolderId == id, ct))
            return Problems.Conflict("Thư mục còn thư mục con hoặc tài liệu (kể cả trong thùng rác) — chuyển / xoá hết trước");
        db.Folders.Remove(f);
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}

/// <summary>Tra tên nhân viên theo Id (gồm cả người đã nghỉ).</summary>
internal static class People
{
    public static async Task<IReadOnlyDictionary<Guid, EmployeeRef>> LoadAsync(IEmployeeDirectory dir, IEnumerable<Guid> ids, CancellationToken ct)
    {
        var want = ids.ToHashSet();
        var map = new Dictionary<Guid, EmployeeRef>();
        if (want.Count == 0) return map;
        foreach (var e in await dir.ListActiveAsync(ct)) if (want.Contains(e.Id)) map[e.Id] = e;
        foreach (var id in want.Where(id => !map.ContainsKey(id)))
            if (await dir.GetAsync(id, ct) is { } e) map[id] = e;
        return map;
    }
}
