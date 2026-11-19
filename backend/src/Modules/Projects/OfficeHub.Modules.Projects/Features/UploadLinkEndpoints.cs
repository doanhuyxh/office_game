using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

/// <param name="Minutes">15 / 60 / 1440 — bỏ trống = 60.</param>
public sealed record NewUploadLink(int? Minutes = null);
/// <param name="Token">Chỉ trả MỘT lần lúc tạo (DB giữ hash) — FE dựng URL <c>/u/{token}</c> + mã QR.</param>
public sealed record UploadLinkCreatedDto(Guid Id, string Token, DateTimeOffset ExpiresAt);
public sealed record UploadLinkDto(Guid Id, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt, int FileCount);
/// <summary>Trang công khai: CHỈ mã việc + hạn + giới hạn (không tên việc, mô tả, bình luận, id).</summary>
public sealed record PublicUploadLinkDto(string TaskCode, DateTimeOffset ExpiresAt, int FileCount, int MaxFiles, int MaxFilesPerComment);
public sealed record PublicUploadRequest(string? FileName, long Size);
/// <param name="FileCount">Tổng số tệp đã gửi qua link sau lần này.</param>
public sealed record PublicUploadDoneDto(int FileCount);

/// <summary>
/// Link tải tệp từ thiết bị khác cho bình luận việc (TEST-175). Người đã đăng nhập (thành viên dự án đang chạy, trên web) tạo link hạn 15 phút / 1 giờ / 24 giờ;
/// ai có link mở trang công khai <c>/u/{token}</c> (không đăng nhập) → xin vé presigned PUT bằng token → PUT thẳng S3 → đăng một bình luận đứng tên người tạo link,
/// nhãn "Qua link tải lên" (lưu id link + IP + User-Agent để tra soát). Hết hạn / thu hồi / dự án đóng / người tạo rời dự án → 410.
/// </summary>
internal static class UploadLinkEndpoints
{
    public const string RateLimitPolicy = "projects-upload-link";

    /// <summary>Giới hạn theo IP cho endpoint công khai (khoá IP + đường dẫn, như đăng nhập).</summary>
    public static void AddRateLimit(IServiceCollection services) =>
        services.Configure<RateLimiterOptions>(o => o.AddPolicy(RateLimitPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
            $"{ctx.Connection.RemoteIpAddress}|{ctx.Request.Path}",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = UploadLinkRules.PublicRequestsPerMinute, Window = TimeSpan.FromMinutes(1) })));

    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/tasks/{tid:guid}/upload-links", CreateAsync);
        g.MapGet("/tasks/{tid:guid}/upload-links", ListAsync);
        g.MapDelete("/upload-links/{id:guid}", RevokeAsync);
    }

    /// <summary>Nhóm công khai <c>/api/projects/public/upload-links</c>: AllowAnonymous, chỉ nhận token trong đường dẫn (không dùng cookie).</summary>
    public static void MapPublic(RouteGroupBuilder g)
    {
        g.MapGet("/{token}", InfoAsync);
        g.MapPost("/{token}/uploads", PublicUploadAsync);
        g.MapPost("/{token}/comments", PublicCommentAsync);
    }

    private static async Task<Results<Ok<UploadLinkCreatedDto>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid tid, NewUploadLink r, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        if (user.IsAccessToken()) return ProjectEndpoints.Forbidden("Tạo link tải lên chỉ làm trên web");
        if (!v.IsMember(t.ProjectId)) return ProjectEndpoints.Forbidden("Chỉ thành viên dự án được tạo link tải lên");
        if (await db.Projects.Where(p => p.Id == t.ProjectId).Select(p => p.Status).FirstAsync(ct) != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng");
        if (UploadLinkRules.Lifetime(r.Minutes) is not { } life) return new Validation().Add("minutes", "Hạn chỉ chọn 15 phút, 1 giờ hoặc 24 giờ").Problem();
        var now = clock.Now;
        var active = await db.CommentUploadLinks.CountAsync(x => x.TaskId == tid && x.UserId == v.UserId && x.RevokedAt == null && x.ExpiresAt > now, ct);
        if (active >= UploadLinkRules.MaxActivePerTask)
            return Problems.Conflict($"Đã có {UploadLinkRules.MaxActivePerTask} link còn hạn cho việc này — thu hồi bớt rồi tạo mới");
        var token = UploadLinkRules.NewToken();
        var link = new CommentUploadLink { TaskId = tid, UserId = v.UserId, TokenHash = UploadLinkRules.Hash(token), CreatedAt = now, ExpiresAt = now + life };
        db.CommentUploadLinks.Add(link);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new UploadLinkCreatedDto(link.Id, token, link.ExpiresAt));
    }

    /// <summary>Link còn hạn CỦA TÔI trên việc (không có token — chỉ để xem số tệp / thu hồi).</summary>
    private static async Task<Results<Ok<List<UploadLinkDto>>, NotFound>> ListAsync(Guid tid, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access,
        ProjectClock clock, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        var t = await db.Tasks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == tid, ct);
        if (t is null || !v.CanSee(t.ProjectId)) return TypedResults.NotFound();
        var now = clock.Now;
        return TypedResults.Ok(await db.CommentUploadLinks.AsNoTracking()
            .Where(x => x.TaskId == tid && x.UserId == v.UserId && x.RevokedAt == null && x.ExpiresAt > now)
            .OrderByDescending(x => x.CreatedAt).Select(x => new UploadLinkDto(x.Id, x.CreatedAt, x.ExpiresAt, x.FileCount)).ToListAsync(ct));
    }

    /// <summary>Thu hồi: chỉ người tạo link. Vé đang treo của link bị bỏ (dọn theo <see cref="UploadCleanup"/>).</summary>
    private static async Task<Results<NoContent, NotFound>> RevokeAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectClock clock, CancellationToken ct)
    {
        var uid = user.GetUserId();
        var link = await db.CommentUploadLinks.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct);
        if (link is null) return TypedResults.NotFound();
        link.RevokedAt ??= clock.Now;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    // ---- Công khai ----

    private sealed record Resolved(CommentUploadLink Link, TaskItem Task, Project Project, ProjectViewer Creator);

    private static ProblemHttpResult Gone() =>
        TypedResults.Problem("Link đã hết hạn hoặc bị thu hồi", statusCode: StatusCodes.Status410Gone);

    /// <summary>Token → link còn hiệu lực. Sai dạng / không có → 404; hết hạn / thu hồi / dự án đóng / người tạo không còn là thành viên → 410.</summary>
    private static async Task<(Resolved? Ok, IResult? Error)> ResolveAsync(string token, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (!UploadLinkRules.LooksLikeToken(token)) return (null, TypedResults.NotFound());
        var hash = UploadLinkRules.Hash(token);
        var link = await db.CommentUploadLinks.FirstOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (link is null) return (null, TypedResults.NotFound());
        var (t, p) = await TaskEndpoints.LoadAsync(link.TaskId, db, ct);
        if (t is null || p is null) return (null, TypedResults.NotFound());
        var creator = await access.MemberViewerAsync(link.UserId, p.Id, ct);
        var state = UploadLinkRules.State(link.ExpiresAt, link.RevokedAt, clock.Now, p.Status == ProjectStatus.Active, creator is not null);
        return state == UploadLinkState.Active ? (new Resolved(link, t, p, creator!), null) : (null, Gone());
    }

    private static async Task<IResult> InfoAsync(string token, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var (ok, error) = await ResolveAsync(token, db, access, clock, ct);
        if (ok is null) return error!;
        return TypedResults.Ok(new PublicUploadLinkDto(EffortRules.TaskCode(ok.Project.Code, ok.Task.Number), ok.Link.ExpiresAt, ok.Link.FileCount,
            UploadLinkRules.MaxFilesPerLink, CommentFileRules.MaxAttachments));
    }

    private static async Task<IResult> PublicUploadAsync(string token, PublicUploadRequest req, ProjectsDbContext db, ProjectAccess access, ProjectClock clock,
        IFileStorage files, CancellationToken ct)
    {
        var (ok, error) = await ResolveAsync(token, db, access, clock, ct);
        if (ok is null) return error!;
        var now = clock.Now;
        var pending = await db.CommentUploadTickets.CountAsync(x => x.UploadLinkId == ok.Link.Id && x.CreatedAt > now - CommentFileRules.UploadUrlTtl, ct);
        if (!UploadLinkRules.FilesLeft(ok.Link.FileCount, pending))
            return TypedResults.Problem($"Link này đã nhận đủ {UploadLinkRules.MaxFilesPerLink} tệp — tạo link mới để gửi tiếp", statusCode: StatusCodes.Status429TooManyRequests);
        return await CommentFileEndpoints.IssueTicketAsync(ok.Task.Id, ok.Link.UserId, false, ok.Link.Id, new CommentUploadRequest(req.FileName, null, req.Size), db, files, now, ct);
    }

    private static async Task<IResult> PublicCommentAsync(string token, NewComment r, HttpContext http, ProjectsDbContext db, ProjectAccess access, IEmployeeDirectory dir,
        INotifier notifier, ITelegramWakeup telegram, ProjectClock clock, IFileStorage files, BotStreakGuard streak, CancellationToken ct)
    {
        var (ok, error) = await ResolveAsync(token, db, access, clock, ct);
        if (ok is null) return error!;
        // Qua link: phải có ít nhất một tệp (ghi chú tuỳ chọn) — trang này để gửi tệp, không phải kênh bình luận chữ.
        if (r.UploadIds is not { Count: > 0 }) return new Validation().Add("uploadIds", "Chọn ít nhất một tệp để gửi").Problem();
        var via = new CommentVia(ok.Link.Id, http.Connection.RemoteIpAddress?.ToString(), UploadLinkRules.CleanUserAgent(http.Request.Headers.UserAgent));
        var res = await TaskEndpoints.PostCommentAsync(ok.Task, ok.Project, ok.Creator, false, r, via, db, access, dir, notifier, telegram, clock, files, streak, ct);
        // Không trả id bình luận / việc ra ngoài — chỉ số tệp đã gửi qua link
        return res.Result is Created<Guid> ? TypedResults.Ok(new PublicUploadDoneDto(ok.Link.FileCount)) : res.Result;
    }
}
