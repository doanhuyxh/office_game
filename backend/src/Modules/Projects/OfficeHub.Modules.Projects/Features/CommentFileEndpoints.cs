using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Imaging;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <summary>Tra tệp bình luận cho module khác (Chat chuyển tiếp — TEST-156); cùng quyền như <see cref="CommentFileEndpoints"/> xem tệp.</summary>
internal sealed class CommentFileLookup(ProjectsDbContext db, ProjectAccess access) : OfficeHub.Modules.Projects.Contracts.ICommentFileLookup
{
    public async Task<OfficeHub.Modules.Projects.Contracts.CommentFileRef?> FindVisibleAsync(Guid attachmentId, ClaimsPrincipal user, CancellationToken ct = default) =>
        await CommentFileEndpoints.VisibleAsync(attachmentId, user, db, access, ct) is { } a
            ? new(a.Id, a.FileKey, a.FileName, a.ContentType, a.Size, a.IsImage)
            : null;
}

/// <param name="Url">Link presigned (hạn <see cref="CommentFileRules.AttachmentUrlTtl"/>; trợ lý AI: <see cref="CommentFileRules.AiAttachmentUrlTtl"/>) — ảnh xem trong trình duyệt, tệp khác tải về.</param>
public sealed record CommentAttachmentDto(Guid Id, string FileName, string ContentType, long Size, bool IsImage, string Url);
public sealed record CommentUploadRequest(string? FileName, string? ContentType, long Size);
public sealed record CommentUploadTicketDto(Guid Id, string Url, string ContentType, DateTimeOffset ExpiresAt);

/// <summary>
/// Tệp đính kèm bình luận việc (TEST-153): xin vé tải lên (presigned PUT thẳng S3), xem thông tin + link hạn ngắn, ảnh thu nhỏ cho trợ lý AI.
/// Gắn tệp vào bình luận ở <c>POST /tasks/{tid}/comments</c> (uploadIds). Quyền: xin vé = thành viên dự án đang chạy (như bình luận);
/// xem = người xem được dự án. DB chỉ giữ khoá S3, không lưu nội dung / base64.
/// </summary>
internal static class CommentFileEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/tasks/{tid:guid}/uploads", CreateUploadAsync);
        g.MapGet("/comment-attachments/{id:guid}", InfoAsync);
        g.MapGet("/comment-attachments/{id:guid}/preview", PreviewAsync);
    }

    private static async Task<Results<Ok<CommentUploadTicketDto>, NotFound, ValidationProblem, ProblemHttpResult>> CreateUploadAsync(Guid tid, CommentUploadRequest req,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, IFileStorage files, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        if (!v.CanWork(t.ProjectId)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được bình luận");
        if (await db.Projects.Where(p => p.Id == t.ProjectId).Select(p => p.Status).FirstAsync(ct) != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");

        var now = clock.Now;
        var byBot = user.IsAccessToken();
        if (byBot)
        {
            var since = now - CommentFileRules.BotQuotaWindow;
            var me = v.Employee?.Id;
            var used = await db.CommentUploadTickets.CountAsync(x => x.UserId == v.UserId && x.ByBot && x.CreatedAt > since, ct)
                + await db.CommentAttachments.CountAsync(a => db.Comments.Any(c => c.Id == a.CommentId && c.ByBot && c.AuthorEmployeeId == me && c.CreatedAt > since), ct);
            if (!CommentFileRules.QuotaLeft(used))
                return TypedResults.Problem($"Đã tải {CommentFileRules.BotUploadsPerHour} tệp qua trợ lý AI trong 1 giờ qua — đợi rồi gửi tiếp",
                    statusCode: StatusCodes.Status429TooManyRequests);
        }

        var name = CommentFileRules.CleanFileName(req.FileName);
        var contentType = FileTypes.ContentTypeFor(name); // theo đuôi, không tin trình duyệt (TEST-13)
        var val = new Validation();
        foreach (var (field, message) in CommentFileRules.ValidateUpload(name, contentType, req.Size)) val.Add(field, message);
        if (val.Failed) return val.Problem();

        // Vé bỏ dở (xin link nhưng không bình luận): xoá vé + file mồ côi (key chính + key tạm)
        await UploadCleanup.PurgeAsync(db.CommentUploadTickets, x => x.CreatedAt < now - CommentFileRules.TicketCleanupAfter, x => x.FileKey, files, db, ct);

        var ticket = new CommentUploadTicket
        {
            TaskId = tid, UserId = v.UserId, ByBot = byBot, FileName = name, ContentType = contentType, Size = req.Size, CreatedAt = now, FileKey = "",
        };
        ticket.FileKey = CommentFileRules.FileKey(now, ticket.Id, name);
        db.CommentUploadTickets.Add(ticket);
        await db.SaveChangesAsync(ct);
        var url = await files.GetUploadUrlAsync(ticket.FileKey, contentType, CommentFileRules.UploadUrlTtl);
        return TypedResults.Ok(new CommentUploadTicketDto(ticket.Id, url, contentType, now + CommentFileRules.UploadUrlTtl));
    }

    /// <summary>Thông tin một tệp + link hạn ngắn — cho tool MCP view_attachment (source = task-comment). Người xem được dự án.</summary>
    private static async Task<Results<Ok<CommentAttachmentDto>, NotFound>> InfoAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        IFileStorage files, CancellationToken ct)
    {
        var att = await VisibleAsync(id, user, db, access, ct);
        if (att is null) return TypedResults.NotFound();
        var url = await files.GetDownloadUrlAsync(att.FileKey, att.FileName, inline: att.IsImage, CommentFileRules.AiAttachmentUrlTtl);
        return TypedResults.Ok(new CommentAttachmentDto(att.Id, att.FileName, att.ContentType, att.Size, att.IsImage, url));
    }

    /// <summary>Ảnh thu nhỏ JPEG cạnh dài ≤ <paramref name="max"/> (mặc định / tối đa 1280) — trợ lý AI nhìn trực tiếp. Không phải ảnh → 400; ảnh hỏng → 422.</summary>
    private static async Task<Results<FileContentHttpResult, NotFound, ProblemHttpResult>> PreviewAsync(Guid id, int? max, ClaimsPrincipal user, HttpContext http,
        ProjectsDbContext db, ProjectAccess access, IFileStorage files, CancellationToken ct)
    {
        var att = await VisibleAsync(id, user, db, access, ct);
        if (att is null) return TypedResults.NotFound();
        if (!att.IsImage) return TypedResults.Problem("Tệp không phải ảnh — dùng link tải về", statusCode: StatusCodes.Status400BadRequest);
        await using var src = await files.OpenReadAsync(att.FileKey, ct);
        var thumb = ImageThumbnail.ToJpeg(src, Math.Clamp(max ?? CommentFileRules.PreviewMaxSide, CommentFileRules.PreviewMinSide, CommentFileRules.PreviewMaxSide));
        if (thumb is null) return TypedResults.Problem("Không đọc được ảnh (hỏng hoặc quá lớn)", statusCode: StatusCodes.Status422UnprocessableEntity);
        http.Response.Headers.CacheControl = "private, no-store";
        return TypedResults.File(thumb.Data, thumb.ContentType);
    }

    /// <summary>Tệp của bình luận thuộc việc trong dự án tôi xem được; không → null (404, không lộ tệp tồn tại).</summary>
    internal static async Task<CommentAttachment?> VisibleAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var row = await (from a in db.CommentAttachments.AsNoTracking()
                         join c in db.Comments.AsNoTracking() on a.CommentId equals c.Id
                         join t in db.Tasks.AsNoTracking() on c.TaskId equals t.Id
                         where a.Id == id
                         select new { a, t.ProjectId }).FirstOrDefaultAsync(ct);
        if (row is null) return null;
        var v = await access.ViewerAsync(user, ct);
        return v.CanSee(row.ProjectId) ? row.a : null;
    }

    /// <summary>DTO tệp kèm link presigned web (60 phút), theo thứ tự tải lên.</summary>
    internal static async Task<List<CommentAttachmentDto>> DtosAsync(IEnumerable<CommentAttachment> atts, IFileStorage files)
    {
        var list = new List<CommentAttachmentDto>();
        foreach (var a in atts.OrderBy(x => x.Id))
            list.Add(new CommentAttachmentDto(a.Id, a.FileName, a.ContentType, a.Size, a.IsImage,
                await files.GetDownloadUrlAsync(a.FileKey, a.FileName, inline: a.IsImage, CommentFileRules.AttachmentUrlTtl)));
        return list;
    }

    /// <summary>Xoá file trên S3 sau khi đã xoá dòng DB (bình luận / việc). Lỗi S3 không làm hỏng request — file lẻ sót lại không ai trỏ tới, không xem được.</summary>
    internal static async Task DeleteFilesAsync(IFileStorage files, IEnumerable<string> keys, CancellationToken ct)
    {
        foreach (var key in keys)
        {
            try { await files.DeleteAsync(key, ct); }
            catch (Exception) when (!ct.IsCancellationRequested) { /* S3 lỗi tạm: bỏ qua */ }
        }
    }
}
