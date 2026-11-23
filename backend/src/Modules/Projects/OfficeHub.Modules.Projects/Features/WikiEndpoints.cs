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

/// <param name="ContentLength">Độ dài nội dung (ký tự) — cây không kèm nội dung.</param>
public sealed record WikiTreeItem(Guid Id, Guid? ParentId, string Title, string? Summary, int Position, int Version, bool Locked,
    DateTimeOffset UpdatedAt, string UpdatedByName, bool UpdatedByBot, int ContentLength);
/// <param name="CanEdit">Người gọi tạo / sửa trang được (trang chưa khoá).</param><param name="CanManage">Người gọi xoá / khoá / khôi phục được.</param>
public sealed record WikiTreeDto(List<WikiTreeItem> Pages, bool CanEdit, bool CanManage, int MaxPages, int MaxDepth, int MaxContent);
public sealed record WikiCrumb(Guid Id, string Title);
/// <param name="Path">Các trang cha từ gốc xuống (không gồm trang này).</param>
public sealed record WikiPageDto(Guid Id, Guid ProjectId, Guid? ParentId, string Title, string? Summary, string Content, int Version, int Position,
    bool Locked, string? LockedByName, DateTimeOffset? LockedAt, DateTimeOffset CreatedAt, string CreatedByName, bool CreatedByBot,
    DateTimeOffset UpdatedAt, string UpdatedByName, bool UpdatedByBot, bool CanEdit, bool CanManage, List<WikiCrumb> Path);
public sealed record WikiSearchHit(Guid Id, Guid? ParentId, string Title, string? Summary, string Snippet, int Version, DateTimeOffset UpdatedAt);
public sealed record WikiVersionItem(int Version, string Title, string? Summary, DateTimeOffset EditedAt, string EditedByName, bool EditedByBot, string? Note, int ContentLength);
public sealed record WikiVersionList(List<WikiVersionItem> Items, int Total, int Page, int PageSize);
public sealed record WikiVersionDto(Guid PageId, int Version, string Title, string? Summary, string Content, DateTimeOffset EditedAt, string EditedByName, bool EditedByBot, string? Note);

/// <param name="ParentId">Trang cha (null = trang gốc).</param>
public sealed record CreateWikiPage(string Title, string? Summary = null, string? Content = null, Guid? ParentId = null, string? Note = null);
/// <param name="BaseVersion">Phiên bản đang sửa — khác phiên bản hiện tại → 409, không ghi đè.</param>
/// <param name="Title">null = giữ nguyên.</param><param name="Summary">null = giữ nguyên, "" = xoá.</param><param name="Content">null = giữ nguyên (thay toàn bộ khi có).</param>
public sealed record UpdateWikiPage(int BaseVersion, string? Title = null, string? Summary = null, string? Content = null, string? Note = null);
public sealed record AppendWikiPage(string Text, string? Note = null);
/// <param name="Position">Vị trí trong cha mới (0 = đầu; lớn hơn số trang = cuối).</param>
public sealed record MoveWikiPage(Guid? ParentId, int Position);

/// <summary>
/// Sổ tay dự án (TEST-215): <c>/api/projects/{id}/wiki</c>. Quyền + giới hạn: <see cref="WikiRules"/>. Người không xem được dự án → 404.
/// Token AI: đọc cây / tìm / trang, tạo, sửa, nối thêm (allowlist <c>AccessTokenAuth</c>); không xoá / khoá / khôi phục / di chuyển.
/// </summary>
internal static class WikiEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var w = g.MapGroup("/{id:guid}/wiki");
        w.MapGet("/", TreeAsync);
        w.MapGet("/search", SearchAsync);
        w.MapPost("/pages", CreateAsync);
        w.MapGet("/pages/{pageId:guid}", GetAsync);
        w.MapPut("/pages/{pageId:guid}", UpdateAsync);
        w.MapPost("/pages/{pageId:guid}/append", AppendAsync);
        w.MapPut("/pages/{pageId:guid}/move", MoveAsync);
        w.MapGet("/pages/{pageId:guid}/versions", VersionsAsync);
        w.MapGet("/pages/{pageId:guid}/versions/{n:int}", VersionAsync);
        w.MapPost("/pages/{pageId:guid}/versions/{n:int}/restore", RestoreAsync);
        w.MapPost("/pages/{pageId:guid}/lock", (Guid id, Guid pageId, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct) =>
            SetLockAsync(id, pageId, true, user, db, access, clock, ct));
        w.MapPost("/pages/{pageId:guid}/unlock", (Guid id, Guid pageId, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct) =>
            SetLockAsync(id, pageId, false, user, db, access, clock, ct));
        w.MapDelete("/pages/{pageId:guid}", DeleteAsync);
    }

    private sealed record Ctx(ProjectViewer V, Project P, bool Active, bool ByToken)
    {
        public WikiDenial? Edit(bool locked = false) => WikiRules.EditDenial(V.CanWork(P.Id), V.CanManage(P.Id), Active, ByToken, locked);
        public WikiDenial? Manage() => WikiRules.ManageDenial(V.CanManage(P.Id), Active, ByToken);
        public (bool CanEdit, bool CanManage) Flags(bool locked) => WikiRules.Flags(V.CanWork(P.Id), V.CanManage(P.Id), Active, ByToken, locked);
    }

    /// <summary>Dự án + người xem; không xem được → null (404).</summary>
    private static async Task<Ctx?> CtxAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id)) return null;
        var p = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return p is null ? null : new Ctx(v, p, p.Status == ProjectStatus.Active, user.IsAccessToken());
    }

    private static Task<WikiPage?> PageAsync(ProjectsDbContext db, Guid projectId, Guid pageId, CancellationToken ct) =>
        db.WikiPages.FirstOrDefaultAsync(x => x.Id == pageId && x.ProjectId == projectId && x.DeletedAt == null, ct);

    private static ProblemHttpResult Deny(WikiDenial d) => TypedResults.Problem(d.Message, statusCode: d.Status);

    private static ProblemHttpResult VersionConflict(WikiPage p) => TypedResults.Problem(
        $"Trang đã được {p.UpdatedByName} sửa (phiên bản {p.Version}) — tải lại rồi sửa tiếp, nội dung chưa được lưu", statusCode: StatusCodes.Status409Conflict,
        extensions: new Dictionary<string, object?> { ["version"] = p.Version, ["updatedByName"] = p.UpdatedByName, ["updatedAt"] = p.UpdatedAt, ["updatedByBot"] = p.UpdatedByBot });

    private static async Task<List<WikiNode>> NodesAsync(ProjectsDbContext db, Guid projectId, CancellationToken ct) =>
        await db.WikiPages.AsNoTracking().Where(x => x.ProjectId == projectId && x.DeletedAt == null).Select(x => new WikiNode(x.Id, x.ParentId)).ToListAsync(ct);

    private static Task<bool> TitleTakenAsync(ProjectsDbContext db, Guid projectId, Guid? parentId, string title, Guid? selfId, CancellationToken ct)
    {
        var lower = title.ToLowerInvariant();
        return db.WikiPages.AnyAsync(x => x.ProjectId == projectId && x.ParentId == parentId && x.DeletedAt == null && x.Id != selfId && x.Title.ToLower() == lower, ct);
    }

    private const string TitleTaken = "Đã có trang cùng tên trong cùng trang cha";

    private static async Task<WikiPageDto> ToDtoAsync(WikiPage p, Ctx c, ProjectsDbContext db, CancellationToken ct)
    {
        var titles = await db.WikiPages.AsNoTracking().Where(x => x.ProjectId == p.ProjectId && x.DeletedAt == null)
            .Select(x => new { x.Id, x.ParentId, x.Title }).ToDictionaryAsync(x => x.Id, ct);
        var path = new List<WikiCrumb>();
        for (var x = p.ParentId; x is { } pid && titles.TryGetValue(pid, out var t) && path.Count < WikiRules.MaxDepth; x = t.ParentId) path.Insert(0, new(t.Id, t.Title));
        var (canEdit, canManage) = c.Flags(p.Locked);
        return new WikiPageDto(p.Id, p.ProjectId, p.ParentId, p.Title, p.Summary, p.Content, p.Version, p.Position, p.Locked, p.LockedByName, p.LockedAt,
            p.CreatedAt, p.CreatedByName, p.CreatedByBot, p.UpdatedAt, p.UpdatedByName, p.UpdatedByBot, canEdit, canManage, path);
    }

    /// <summary>Ghi nội dung mới + thêm phiên bản (Version + 1).</summary>
    private static void Save(ProjectsDbContext db, WikiPage p, Ctx c, string title, string? summary, string content, string? note, DateTimeOffset now)
    {
        p.Title = title; p.Summary = summary; p.Content = content;
        p.Version++;
        p.UpdatedAt = now; p.UpdatedByEmployeeId = c.V.Employee?.Id; p.UpdatedByName = c.V.Name; p.UpdatedByBot = c.ByToken;
        db.WikiPageVersions.Add(new WikiPageVersion
        {
            PageId = p.Id, Version = p.Version, Title = title, Summary = summary, Content = content, EditedAt = now,
            EditedByEmployeeId = c.V.Employee?.Id, EditedByName = c.V.Name, EditedByBot = c.ByToken, Note = ProjectEndpoints.Clean(note),
        });
    }

    /// <summary>Lưu; trùng phiên bản do hai người lưu cùng lúc (ux_wiki_page_versions_page_version) → false.</summary>
    private static async Task<bool> TrySaveAsync(ProjectsDbContext db, CancellationToken ct)
    {
        try { await db.SaveChangesAsync(ct); return true; }
        catch (DbUpdateException) { return false; }
    }

    private static async Task<Results<Ok<WikiTreeDto>, NotFound>> TreeAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        var pages = await db.WikiPages.AsNoTracking().Where(x => x.ProjectId == id && x.DeletedAt == null)
            .OrderBy(x => x.ParentId).ThenBy(x => x.Position).ThenBy(x => x.Title)
            .Select(x => new WikiTreeItem(x.Id, x.ParentId, x.Title, x.Summary, x.Position, x.Version, x.Locked, x.UpdatedAt, x.UpdatedByName, x.UpdatedByBot, x.Content.Length))
            .ToListAsync(ct);
        var (canEdit, canManage) = c.Flags(false);
        return TypedResults.Ok(new WikiTreeDto(pages, canEdit, canManage, WikiRules.MaxPagesPerProject, WikiRules.MaxDepth, WikiRules.MaxContent));
    }

    private static async Task<Results<Ok<List<WikiSearchHit>>, NotFound, ValidationProblem>> SearchAsync(Guid id, string? q, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is null) return TypedResults.NotFound();
        var term = q?.Trim() ?? "";
        var val = new Validation().Required(term, "q", "Từ khoá").MaxLength(term, WikiRules.MaxQuery, "q", "Từ khoá");
        if (val.Failed) return val.Problem();
        var like = Like.Contains(term);
        var rows = await db.WikiPages.AsNoTracking()
            .Where(x => x.ProjectId == id && x.DeletedAt == null
                        && (EF.Functions.ILike(x.Title, like) || EF.Functions.ILike(x.Summary ?? "", like) || EF.Functions.ILike(x.Content, like)))
            .OrderByDescending(x => EF.Functions.ILike(x.Title, like)).ThenByDescending(x => x.UpdatedAt)
            .Take(WikiRules.MaxSearchResults).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(x => new WikiSearchHit(x.Id, x.ParentId, x.Title, x.Summary,
            WikiRules.Snippet(x.Content.Contains(term, StringComparison.OrdinalIgnoreCase) ? x.Content : (x.Summary ?? x.Content), term),
            x.Version, x.UpdatedAt)).ToList());
    }

    private static async Task<Results<Ok<WikiPageDto>, NotFound>> GetAsync(Guid id, Guid pageId, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
    }

    private static async Task<Results<Created<WikiPageDto>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, CreateWikiPage r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (c.Edit() is { } d) return Deny(d);
        var title = WikiRules.NormalizeTitle(r.Title);
        var summary = WikiRules.NormalizeSummary(r.Summary);
        var content = WikiRules.NormalizeContent(r.Content);
        var val = new Validation();
        foreach (var (f, m) in WikiRules.Errors(title, summary, content, r.Note)) val.Add(f, m);
        var nodes = await NodesAsync(db, id, ct);
        if (WikiRules.PlacementError(null, r.ParentId, nodes) is { } pe) val.Add("parentId", pe);
        if (!val.Has("title") && !val.Has("parentId") && await TitleTakenAsync(db, id, r.ParentId, title, null, ct)) val.Add("title", TitleTaken);
        if (val.Failed) return val.Problem();
        if (nodes.Count >= WikiRules.MaxPagesPerProject) return Problems.Conflict($"Sổ tay tối đa {WikiRules.MaxPagesPerProject} trang / dự án");
        var now = clock.Now;
        var p = new WikiPage
        {
            ProjectId = id, ParentId = r.ParentId, Title = title, Position = nodes.Count(n => n.ParentId == r.ParentId), Version = 0,
            CreatedAt = now, CreatedByEmployeeId = c.V.Employee?.Id, CreatedByName = c.V.Name, CreatedByBot = c.ByToken,
        };
        db.WikiPages.Add(p);
        Save(db, p, c, title, summary, content, r.Note, now);
        await db.SaveChangesAsync(ct);
        return TypedResults.Created($"/api/projects/{id}/wiki/pages/{p.Id}", await ToDtoAsync(p, c, db, ct));
    }

    private static async Task<Results<Ok<WikiPageDto>, NotFound, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, Guid pageId, UpdateWikiPage r,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        if (c.Edit(p.Locked) is { } d) return Deny(d);
        var title = r.Title is null ? p.Title : WikiRules.NormalizeTitle(r.Title);
        var summary = r.Summary is null ? p.Summary : WikiRules.NormalizeSummary(r.Summary);
        var content = r.Content is null ? p.Content : WikiRules.NormalizeContent(r.Content);
        var val = new Validation();
        foreach (var (f, m) in WikiRules.Errors(title, summary, content, r.Note)) val.Add(f, m);
        if (val.Failed) return val.Problem();
        if (r.BaseVersion != p.Version) return VersionConflict(p);
        if (WikiRules.IsUnchanged(p.Title, p.Summary, p.Content, title, summary, content)) return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
        if (!WikiRules.SameTitle(p.Title, title) && await TitleTakenAsync(db, id, p.ParentId, title, p.Id, ct)) return val.Add("title", TitleTaken).Problem();
        Save(db, p, c, title, summary, content, r.Note, clock.Now);
        if (!await TrySaveAsync(db, ct))
        {
            db.ChangeTracker.Clear();
            return await PageAsync(db, id, pageId, ct) is { } now ? VersionConflict(now) : TypedResults.NotFound();
        }
        return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
    }

    private static async Task<Results<Ok<WikiPageDto>, NotFound, ValidationProblem, ProblemHttpResult>> AppendAsync(Guid id, Guid pageId, AppendWikiPage r,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        if (c.Edit(p.Locked) is { } d) return Deny(d);
        var val = new Validation().Required(r.Text, "text", "Nội dung nối thêm").MaxLength(r.Note, WikiRules.MaxNote, "note", "Ghi chú");
        if (val.Failed) return val.Problem();
        var content = WikiRules.Append(p.Content, r.Text);
        if (content.Length > WikiRules.MaxContent) return val.Add("text", $"Nối thêm làm trang vượt 50.000 ký tự (hiện {p.Content.Length} ký tự) — tách sang trang mới").Problem();
        Save(db, p, c, p.Title, p.Summary, content, r.Note, clock.Now);
        // Hai lần nối cùng lúc trùng phiên bản → thử lại một lần trên bản mới nhất (nối thêm không cần baseVersion)
        if (!await TrySaveAsync(db, ct))
        {
            db.ChangeTracker.Clear();
            if (await PageAsync(db, id, pageId, ct) is not { } fresh) return TypedResults.NotFound();
            p = fresh;
            content = WikiRules.Append(p.Content, r.Text);
            if (content.Length > WikiRules.MaxContent) return val.Add("text", "Nối thêm làm trang vượt 50.000 ký tự — tách sang trang mới").Problem();
            Save(db, p, c, p.Title, p.Summary, content, r.Note, clock.Now);
            if (!await TrySaveAsync(db, ct)) return Problems.Conflict("Trang đang được sửa cùng lúc — thử lại");
        }
        return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
    }

    private static async Task<Results<Ok<WikiPageDto>, NotFound, ValidationProblem, ProblemHttpResult>> MoveAsync(Guid id, Guid pageId, MoveWikiPage r,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        if (c.Edit(p.Locked) is { } d) return Deny(d);
        var nodes = await NodesAsync(db, id, ct);
        if (WikiRules.PlacementError(p.Id, r.ParentId, nodes) is { } pe) return new Validation().Add("parentId", pe).Problem();
        if (r.ParentId != p.ParentId && await TitleTakenAsync(db, id, r.ParentId, p.Title, p.Id, ct)) return new Validation().Add("parentId", TitleTaken).Problem();
        var oldParent = p.ParentId;
        var siblings = await db.WikiPages.Where(x => x.ProjectId == id && x.DeletedAt == null && (x.ParentId == r.ParentId || x.ParentId == oldParent))
            .ToListAsync(ct);
        p.ParentId = r.ParentId;
        var target = siblings.Where(x => x.ParentId == r.ParentId && x.Id != p.Id).OrderBy(x => x.Position).ThenBy(x => x.Title).Select(x => x.Id).ToList();
        var order = WikiRules.Reorder(target, p.Id, r.Position);
        var byId = siblings.ToDictionary(x => x.Id);
        byId[p.Id] = p;
        for (var i = 0; i < order.Count; i++) byId[order[i]].Position = i;
        if (oldParent != r.ParentId)
        {
            var rest = siblings.Where(x => x.ParentId == oldParent && x.Id != p.Id).OrderBy(x => x.Position).ThenBy(x => x.Title).ToList();
            for (var i = 0; i < rest.Count; i++) rest[i].Position = i;
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
    }

    private static async Task<Results<Ok<WikiVersionList>, NotFound>> VersionsAsync(Guid id, Guid pageId, int? page, int? pageSize, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is null) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is null) return TypedResults.NotFound();
        var size = Math.Clamp(pageSize ?? 20, 1, WikiRules.MaxVersionPageSize);
        var n = Math.Max(1, page ?? 1);
        var q = db.WikiPageVersions.AsNoTracking().Where(x => x.PageId == pageId);
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(x => x.Version).Skip((n - 1) * size).Take(size)
            .Select(x => new WikiVersionItem(x.Version, x.Title, x.Summary, x.EditedAt, x.EditedByName, x.EditedByBot, x.Note, x.Content.Length)).ToListAsync(ct);
        return TypedResults.Ok(new WikiVersionList(items, total, n, size));
    }

    private static async Task<Results<Ok<WikiVersionDto>, NotFound>> VersionAsync(Guid id, Guid pageId, int n, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is null) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is null) return TypedResults.NotFound();
        var x = await db.WikiPageVersions.AsNoTracking().FirstOrDefaultAsync(x => x.PageId == pageId && x.Version == n, ct);
        return x is null ? TypedResults.NotFound()
            : TypedResults.Ok(new WikiVersionDto(x.PageId, x.Version, x.Title, x.Summary, x.Content, x.EditedAt, x.EditedByName, x.EditedByBot, x.Note));
    }

    private static async Task<Results<Ok<WikiPageDto>, NotFound, ProblemHttpResult>> RestoreAsync(Guid id, Guid pageId, int n, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        if (c.Manage() is { } d) return Deny(d);
        var old = await db.WikiPageVersions.AsNoTracking().FirstOrDefaultAsync(x => x.PageId == pageId && x.Version == n, ct);
        if (old is null) return TypedResults.NotFound();
        if (WikiRules.IsUnchanged(p.Title, p.Summary, p.Content, old.Title, old.Summary, old.Content)) return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
        if (!WikiRules.SameTitle(p.Title, old.Title) && await TitleTakenAsync(db, id, p.ParentId, old.Title, p.Id, ct))
            return Problems.Conflict($"Không khôi phục được: đã có trang \"{old.Title}\" trong cùng trang cha");
        Save(db, p, c, old.Title, old.Summary, old.Content, $"Khôi phục phiên bản {n}", clock.Now);
        if (!await TrySaveAsync(db, ct)) return Problems.Conflict("Trang vừa được sửa cùng lúc — tải lại rồi thử lại");
        return TypedResults.Ok(await ToDtoAsync(p, c, db, ct));
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> SetLockAsync(Guid id, Guid pageId, bool locked, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        if (c.Manage() is { } d) return Deny(d);
        if (p.Locked == locked) return TypedResults.NoContent();
        p.Locked = locked;
        p.LockedByName = locked ? c.V.Name : null;
        p.LockedAt = locked ? clock.Now : null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> DeleteAsync(Guid id, Guid pageId, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (await PageAsync(db, id, pageId, ct) is not { } p) return TypedResults.NotFound();
        if (c.Manage() is { } d) return Deny(d);
        if (await db.WikiPages.AnyAsync(x => x.ParentId == p.Id && x.DeletedAt == null, ct))
            return Problems.Conflict("Trang còn trang con — xoá hoặc chuyển các trang con trước");
        p.DeletedAt = clock.Now;
        p.DeletedByName = c.V.Name;
        var rest = await db.WikiPages.Where(x => x.ProjectId == id && x.ParentId == p.ParentId && x.DeletedAt == null && x.Id != p.Id)
            .OrderBy(x => x.Position).ThenBy(x => x.Title).ToListAsync(ct);
        for (var i = 0; i < rest.Count; i++) rest[i].Position = i;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
