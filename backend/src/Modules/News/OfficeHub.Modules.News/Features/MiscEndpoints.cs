using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;
using static OfficeHub.Modules.News.Features.PostEndpoints;

namespace OfficeHub.Modules.News.Features;

/// <summary>Tải tệp lên S3 (<c>feed/</c>), link tải, danh sách người / phòng ban để chọn phạm vi và @nhắc.</summary>
public static class MiscEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/uploads", CreateUploadAsync);
        g.MapGet("/media/{id:guid}/url", MediaUrlAsync);
        g.MapGet("/people", PeopleAsync);
        g.MapGet("/departments", DepartmentsAsync);
    }

    private static async Task<Results<Ok<UploadTicketDto>, ValidationProblem>> CreateUploadAsync(UploadRequest req, ClaimsPrincipal user, NewsDbContext db,
        IFileStorage files, TimeProvider clock, CancellationToken ct)
    {
        var name = NewsRules.CleanFileName(req.FileName);
        var contentType = FileTypes.ContentTypeFor(name); // TEST-13: theo đuôi, không tin trình duyệt
        var val = new Validation();
        foreach (var (f, m) in NewsRules.ValidateUpload(name, contentType, req.Size, req.ForComment)) val.Add(f, m);
        if (val.Failed) return val.Problem();

        var now = clock.GetUtcNow();
        // Dọn vé bỏ dở (đã xin link nhưng không đăng): xoá cả file mồ côi trên S3 (key chính + key tạm) — TEST-54
        await UploadCleanup.PurgeAsync(db.UploadTickets, t => t.CreatedAt < now - NewsRules.TicketCleanupAfter, t => t.FileKey, files, db, ct);
        var ticket = new UploadTicket
        {
            UserId = Me(user), Kind = NewsRules.KindOf(contentType), FileName = name, ContentType = contentType, Size = req.Size, CreatedAt = now, FileKey = "",
        };
        ticket.FileKey = NewsRules.FileKey(now, ticket.Id, name);
        db.UploadTickets.Add(ticket);
        await db.SaveChangesAsync(ct);
        var url = await files.GetUploadUrlAsync(ticket.FileKey, contentType, NewsRules.UploadUrlTtl);
        return TypedResults.Ok(new UploadTicketDto(ticket.Id, url, contentType, ticket.Kind, now + NewsRules.UploadUrlTtl));
    }

    /// <summary>Link mới cho một tệp của bài (link trong feed hết hạn sau 60 phút). 404 nếu bài ngoài phạm vi.</summary>
    private static async Task<Results<Ok<UrlDto>, ProblemHttpResult>> MediaUrlAsync(Guid id, bool? download, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        IFileStorage files, CancellationToken ct)
    {
        var m = await db.Media.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        var v = await store.ViewerAsync(Me(user), user.IsHr(), ct);
        if (m is null || await store.FindVisibleAsync(m.PostId, v, ct) is null) return Problems.NotFound("tệp");
        return TypedResults.Ok(new UrlDto(await files.GetDownloadUrlAsync(m.FileKey, m.FileName, inline: m.Kind != MediaKind.File && download != true, NewsRules.MediaUrlTtl)));
    }

    private static async Task<Ok<List<PersonDto>>> PeopleAsync(string? search, ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct)
    {
        var me = Me(user);
        var term = NewsRules.Fold(search?.Trim());
        var people = (await dir.ListActiveAsync(ct))
            .Where(e => e.UserId is { } u && u != me)
            .Where(e => term.Length == 0 || NewsRules.Fold(e.FullName).Contains(term) || NewsRules.Fold(e.Code).Contains(term))
            .OrderBy(e => e.FullName, StringComparer.CurrentCultureIgnoreCase)
            .Take(20)
            .Select(e => new PersonDto(e.UserId!.Value, e.FullName, e.Code, e.DepartmentName))
            .ToList();
        return TypedResults.Ok(people);
    }

    private static async Task<Ok<List<DepartmentDto>>> DepartmentsAsync(IEmployeeDirectory dir, CancellationToken ct) =>
        TypedResults.Ok((await dir.ListDepartmentsAsync(ct)).OrderBy(d => d.Name).Select(d => new DepartmentDto(d.Id, d.Name, d.ParentId)).ToList());
}
