using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>
/// Chi tiết Fanpage + bài viết hiện có đồng bộ từ Facebook (TEST-206): <c>/api/assets/social/facebook/pages/{id}</c>, <c>/posts</c>, <c>/sync-posts</c>.
/// Chỉ HR + người đang giữ BM của trang; người khác → 404. Không mở cho token AI (route không có trong danh sách cho phép của <c>AccessTokenAuth</c>).
/// </summary>
internal static class SocialPageEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var s = g.MapGroup($"{SocialRules.FacebookApiPrefix}/pages/{{id:guid}}").RequireAuthorization();
        s.MapGet("", GetAsync);
        s.MapGet("/posts", PostsAsync);
        s.MapPost("/sync-posts", SyncAsync);
        // Ẩn / hiện lại / xoá bài trên Facebook (TEST-211)
        s.MapPost("/posts/{postId:guid}/hide", (Guid id, Guid postId, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialService social,
            CancellationToken ct) => ModerateAsync(id, postId, PagePostAction.Hide, user, db, access, social, ct));
        s.MapPost("/posts/{postId:guid}/unhide", (Guid id, Guid postId, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialService social,
            CancellationToken ct) => ModerateAsync(id, postId, PagePostAction.Unhide, user, db, access, social, ct));
        s.MapDelete("/posts/{postId:guid}", (Guid id, Guid postId, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialService social,
            CancellationToken ct) => ModerateAsync(id, postId, PagePostAction.Delete, user, db, access, social, ct));
        // Bình luận + trả lời bình luận dưới tên Trang (TEST-212)
        s.MapGet("/posts/{postId:guid}/comments", CommentsAsync);
        s.MapGet("/posts/{postId:guid}/comments/{commentId}/replies", RepliesAsync);
        s.MapPost("/posts/{postId:guid}/comments/{commentId}/replies", ReplyAsync);
    }

    /// <summary>Trang + BM nếu người xem được xem (HR / người đang giữ BM đang dùng); null → 404.</summary>
    private static async Task<(SocialPage Page, SocialAccount Account)?> FindAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        bool track, CancellationToken ct)
    {
        var pages = track ? db.SocialPages : db.SocialPages.AsNoTracking();
        var page = await pages.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (page is null) return null;
        var account = await db.SocialAccounts.AsNoTracking().FirstAsync(a => a.Id == page.AccountId, ct);
        var me = await access.ViewerAsync(user, ct);
        return SocialRules.CanViewPage(me.IsHr, me.Employee?.Id, account.Status, account.HolderEmployeeId) ? (page, account) : null;
    }

    private static async Task<SocialPageDetailDto> DetailAsync(SocialPage page, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        // Đọc lại BM: đồng bộ bài có thể vừa đánh dấu token lỗi
        var account = await db.SocialAccounts.AsNoTracking().FirstAsync(a => a.Id == page.AccountId, ct);
        var holder = account.HolderEmployeeId is { } h ? (await access.EmployeesAsync(ct)).GetValueOrDefault(h) : null;
        var count = await db.SocialPagePosts.CountAsync(p => p.PageId == page.Id && p.DeletedAt == null, ct);
        var deleted = await db.SocialPagePosts.CountAsync(p => p.PageId == page.Id && p.DeletedAt != null, ct);
        return new(SocialAccountEndpoints.ToDto(page, account.Name), account.Status, account.TokenStatus, holder?.FullName, page.PostsSyncedAt?.ToUniversalTime(),
            page.PostsSyncError, SocialService.IsSyncingPosts(page.Id), count, page.IsActive && page.TokenEncrypted is not null, deleted);
    }

    private static async Task<Results<Ok<SocialPageDetailDto>, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, CancellationToken ct) =>
        await FindAsync(id, user, db, access, false, ct) is { } f ? TypedResults.Ok(await DetailAsync(f.Page, db, access, ct)) : Problems.NotFound("trang");

    /// <summary>
    /// Bài đã đồng bộ, mới nhất trước; cờ "đăng từ OfficeHub" theo đích có cùng ID bài trên trang. Mặc định bỏ bài đã xoá (TEST-211);
    /// <c>deleted=true</c> → chỉ bài đã xoá (xem lại).
    /// </summary>
    private static async Task<Results<Ok<PagedResult<SocialPagePostDto>>, ProblemHttpResult>> PostsAsync(Guid id, int? page, int? pageSize, bool? deleted,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        if (await FindAsync(id, user, db, access, false, ct) is not { } f) return Problems.NotFound("trang");
        var q = db.SocialPagePosts.AsNoTracking().Where(p => p.PageId == f.Page.Id);
        q = deleted == true ? q.Where(p => p.DeletedAt != null) : q.Where(p => p.DeletedAt == null);
        var rows = await q.OrderByDescending(p => p.CreatedTime).ThenByDescending(p => p.Id).ToPagedAsync(page ?? 1, pageSize, ct);
        var ext = rows.Items.Select(p => p.ExternalPostId).ToList();
        var targets = (await db.SocialTargets.AsNoTracking().Where(t => t.PageId == f.Page.Id && t.ExternalPostId != null && ext.Contains(t.ExternalPostId))
            .Select(t => new { t.ExternalPostId, t.PostId }).ToListAsync(ct)).DistinctBy(t => t.ExternalPostId).ToDictionary(t => t.ExternalPostId!, t => t.PostId);
        return TypedResults.Ok(rows.With<SocialPagePost, SocialPagePostDto>([.. rows.Items.Select(p =>
            ToDto(p, f.Page, targets.TryGetValue(p.ExternalPostId, out var pid) ? pid : null))]));
    }

    private static SocialPagePostDto ToDto(SocialPagePost p, SocialPage page, Guid? postId) =>
        new(p.Id, p.ExternalPostId, p.Message, p.CreatedTime, p.Permalink, p.PictureUrl, p.StatusType, p.ReactionCount, p.CommentCount, p.ShareCount,
            p.SyncedAt, postId is not null || p.PostTargetId is not null, postId, p.IsHidden, p.HiddenAt?.ToUniversalTime(), p.HiddenByName,
            p.DeletedAt?.ToUniversalTime(), p.DeletedByName,
            SocialRules.CannotModeratePagePost(page.IsActive, page.TokenEncrypted is not null, p.DeletedAt is not null) is null);

    /// <summary>
    /// Ẩn / hiện lại / xoá một bài của trang trên Facebook (TEST-211). Quyền như xem trang (<see cref="SocialRules.CanModeratePagePost"/>: HR gồm
    /// Quản trị viên / người đang giữ BM) — khác → 404. Facebook từ chối, trang không còn / không có page token, token hỏng, bài đã xoá (khi ẩn /
    /// hiện) → 409 kèm lý do. Xoá bài đã xoá rồi → 200. Trả bài sau khi đổi.
    /// </summary>
    private static async Task<Results<Ok<SocialPagePostDto>, ProblemHttpResult>> ModerateAsync(Guid id, Guid postId, PagePostAction action,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialService social, CancellationToken ct)
    {
        if (await FindAsync(id, user, db, access, false, ct) is not { } f) return Problems.NotFound("trang");
        var row = await db.SocialPagePosts.FirstOrDefaultAsync(p => p.Id == postId && p.PageId == f.Page.Id, ct);
        if (row is null) return Problems.NotFound("bài viết");
        var me = await access.ViewerAsync(user, ct);
        if (await social.ModeratePagePostAsync(f.Page, row, action, me.Name, ct) is { } error) return Problems.Conflict(error);
        var origin = await db.SocialTargets.AsNoTracking()
            .Where(t => t.PageId == f.Page.Id && (t.Id == row.PostTargetId || t.ExternalPostId == row.ExternalPostId))
            .Select(t => (Guid?)t.PostId).FirstOrDefaultAsync(ct);
        return TypedResults.Ok(ToDto(row, f.Page, origin));
    }

    /// <summary>Trang + bài (theo dõi để đánh dấu đã xoá) nếu người xem được xem trang; null → 404.</summary>
    private static async Task<(SocialPage Page, SocialAccount Account, SocialPagePost Row)?> FindPostAsync(Guid id, Guid postId, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        if (await FindAsync(id, user, db, access, false, ct) is not { } f) return null;
        var row = await db.SocialPagePosts.FirstOrDefaultAsync(p => p.Id == postId && p.PageId == f.Page.Id, ct);
        return row is null ? null : (f.Page, f.Account, row);
    }

    private static ProblemHttpResult Problem(SocialCallError e) => TypedResults.Problem(e.Message, statusCode: e.Status);

    private static string? Cursor(string? after) => string.IsNullOrWhiteSpace(after) ? null : after.Length <= 500 ? after.Trim() : null;

    private static async Task<SocialCommentListDto> ListDtoAsync(FbCommentPage list, SocialPage page, SocialAccount account, SocialPagePost row,
        SocialCommentService comments, CancellationToken ct)
    {
        var log = await comments.RepliesByFacebookIdAsync(list.Items.Select(c => c.Id), ct);
        var blocked = SocialCommentService.ReplyBlockedReason(page, account, row);
        return new([.. list.Items.Select(c => ToDto(c, page, log.GetValueOrDefault(c.Id)))], list.After, blocked is null, blocked);
    }

    private static SocialCommentDto ToDto(FbComment c, SocialPage page, SocialCommentReply? log) =>
        new(c.Id, c.Message, c.FromId, c.FromName, c.FromPictureUrl, c.FromId is not null && c.FromId == page.ExternalId, c.CreatedTime, c.LikeCount,
            c.CommentCount, c.AttachmentType, c.AttachmentImageUrl, c.AttachmentUrl, log?.ByName, log?.CreatedAt.ToUniversalTime());

    /// <summary>
    /// Bình luận cấp 1 của bài, mới nhất trước, 25 / lần (<c>after</c> = cursor từ lần trước) — lấy thẳng từ Facebook (TEST-212). Quyền như xem trang
    /// (HR / người đang giữ BM), khác → 404. Bài đã mất trên Facebook → 404 + đánh dấu đã xoá; token hỏng → 409; lỗi mạng → 502.
    /// </summary>
    private static async Task<Results<Ok<SocialCommentListDto>, ProblemHttpResult>> CommentsAsync(Guid id, Guid postId, string? after,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialCommentService comments, CancellationToken ct)
    {
        if (await FindPostAsync(id, postId, user, db, access, ct) is not { } f) return Problems.NotFound("bài viết");
        var (list, error) = await comments.ListAsync(f.Page, f.Row, null, Cursor(after), ct);
        return error is not null ? Problem(error) : TypedResults.Ok(await ListDtoAsync(list!, f.Page, f.Account, f.Row, comments, ct));
    }

    /// <summary>Trả lời của một bình luận, cũ nhất trước, 25 / lần. Bình luận không còn → 404 "Bình luận không còn trên Facebook".</summary>
    private static async Task<Results<Ok<SocialCommentListDto>, ProblemHttpResult>> RepliesAsync(Guid id, Guid postId, string commentId, string? after,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialCommentService comments, CancellationToken ct)
    {
        if (!SocialRules.IsCommentId(commentId)) return Problems.NotFound("bình luận");
        if (await FindPostAsync(id, postId, user, db, access, ct) is not { } f) return Problems.NotFound("bài viết");
        var (list, error) = await comments.ListAsync(f.Page, f.Row, commentId, Cursor(after), ct);
        return error is not null ? Problem(error) : TypedResults.Ok(await ListDtoAsync(list!, f.Page, f.Account, f.Row, comments, ct));
    }

    /// <summary>
    /// Trả lời bình luận dưới tên Trang (TEST-212): nội dung 1–8 000 ký tự (400 theo field <c>message</c>). Token thiếu
    /// <c>pages_manage_engagement</c> / token lỗi / trang không còn → 409; bình luận đã xoá → 404; lỗi mạng → 502. Bấm trùng trong 30 giây → trả
    /// trả lời cũ, không gửi lần nữa.
    /// </summary>
    private static async Task<Results<Ok<SocialCommentReplyResultDto>, ValidationProblem, ProblemHttpResult>> ReplyAsync(Guid id, Guid postId,
        string commentId, SocialCommentReplyRequest req, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, SocialCommentService comments,
        CancellationToken ct)
    {
        if (!SocialRules.IsCommentId(commentId)) return Problems.NotFound("bình luận");
        if (await FindPostAsync(id, postId, user, db, access, ct) is not { } f) return Problems.NotFound("bài viết");
        if (SocialRules.ValidateReply(req.Message) is { } invalid) return new Validation().Add("message", invalid).Problem();
        var me = await access.ViewerAsync(user, ct);
        var (reply, duplicate, error) = await comments.ReplyAsync(f.Page, f.Account, f.Row, commentId, req.Message!, me.UserId, me.Name, ct);
        if (error is not null) return Problem(error);
        var r = reply!;
        return TypedResults.Ok(new SocialCommentReplyResultDto(new(r.ReplyFacebookId, r.Message, f.Page.ExternalId, f.Page.Name, f.Page.PictureUrl, true,
            r.CreatedAt.ToUniversalTime(), 0, 0, null, null, null, r.ByName, r.CreatedAt.ToUniversalTime()), duplicate));
    }

    /// <summary>
    /// Đồng bộ ngay 100 bài mới nhất rồi trả chi tiết mới. Đang đồng bộ / vừa đồng bộ thành công &lt; 1 phút → trả kết quả hiện có (chặn bấm dồn).
    /// </summary>
    private static async Task<Results<Ok<SocialPageDetailDto>, ProblemHttpResult>> SyncAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, SocialService social, AssetClock clock, CancellationToken ct)
    {
        if (await FindAsync(id, user, db, access, true, ct) is not { } f) return Problems.NotFound("trang");
        var page = f.Page;
        if (SocialService.IsSyncingPosts(page.Id) || SocialRules.PostsSyncTooSoon(page.PostsSyncedAt, clock.Now))
            return TypedResults.Ok(await DetailAsync(page, db, access, ct));
        if (!page.IsActive) return Problems.Conflict("Trang không còn trong BM — đồng bộ lại BM để kiểm tra");
        if (page.TokenEncrypted is null) return Problems.Conflict("Chưa có quyền với trang này — nhờ HR kiểm tra quyền System User rồi đồng bộ lại BM");
        await social.SyncPagePostsAsync(page, ct);
        return TypedResults.Ok(await DetailAsync(page, db, access, ct));
    }
}
