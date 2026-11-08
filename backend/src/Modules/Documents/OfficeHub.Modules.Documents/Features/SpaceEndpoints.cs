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

/// <summary>Kho (công ty / phòng ban / dự án), thư mục. Dự án do module Projects quản lý.</summary>
internal static class SpaceEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/spaces", SpacesAsync);

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
        foreach (var p in (await access.ProjectsAsync(ct)).Where(p => DocumentAccess.CanRead(v, SpaceKind.Project, p.Id)))
            list.Add(new(SpaceKind.Project, p.Id, p.Name, DocumentRules.SpaceCode(SpaceKind.Project, p.Code), null, p.IsActive,
                DocumentAccess.CanManage(v, SpaceKind.Project, p.Id), !p.IsActive));
        return TypedResults.Ok(list);
    }

    // Dự án + thành viên: module Projects (/api/projects) từ 2026-11-08.

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
