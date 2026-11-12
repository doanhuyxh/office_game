using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using static OfficeHub.Modules.News.Features.PostEndpoints;

namespace OfficeHub.Modules.News.Features;

/// <summary>Bình luận (trả lời một cấp, ảnh tuỳ chọn, @nhắc) và cảm xúc cho bình luận. Quyền xem bình luận = quyền xem bài.</summary>
public static class CommentEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/posts/{id:guid}/comments", ListAsync);
        g.MapPost("/posts/{id:guid}/comments", CreateAsync);
        g.MapPut("/comments/{id:guid}", EditAsync);
        g.MapDelete("/comments/{id:guid}", DeleteAsync);
        g.MapPut("/comments/{id:guid}/reaction", ReactAsync);
        g.MapDelete("/comments/{id:guid}/reaction", UnreactAsync);
        g.MapGet("/comments/{id:guid}/reactions", ReactorsAsync);
    }

    private static ProblemHttpResult NoComment() => Problems.NotFound("bình luận");

    private static async Task<Results<Ok<CommentPageDto>, ProblemHttpResult>> ListAsync(Guid id, long? after, int? take, ClaimsPrincipal user, NewsDbContext db,
        NewsStore store, CancellationToken ct)
    {
        var v = await store.ViewerAsync(Me(user), user.IsHr(), ct);
        if (await store.FindVisibleAsync(id, v, ct) is null) return NoPost();
        var n = Math.Clamp(take ?? 20, 1, 50);

        // Bình luận gốc đã xoá mà không còn trả lời nào thì bỏ hẳn; còn trả lời thì giữ chỗ "đã bị xoá"
        var roots = db.Comments.AsNoTracking().Where(c => c.PostId == id && c.ParentId == null
            && (c.DeletedAt == null || db.Comments.Any(r => r.ParentId == c.Id && r.DeletedAt == null)));
        if (after is > 0) roots = roots.Where(c => c.Seq > after);
        var top = await roots.OrderBy(c => c.Seq).Take(n + 1).ToListAsync(ct);
        var more = top.Count > n;
        top = top.Take(n).ToList();
        var parentIds = top.Select(c => c.Id).ToList();
        var replies = await db.Comments.AsNoTracking().Where(c => c.ParentId != null && parentIds.Contains(c.ParentId.Value) && c.DeletedAt == null)
            .OrderBy(c => c.Seq).ToListAsync(ct);
        var dtos = await store.ToCommentDtosAsync([.. top, .. replies], v, user.IsAccessToken(), ct);
        return TypedResults.Ok(new CommentPageDto(dtos, more));
    }

    private static async Task<Results<Ok<CommentDto>, ProblemHttpResult, ValidationProblem>> CreateAsync(Guid id, CommentRequest req, ClaimsPrincipal user,
        NewsDbContext db, NewsStore store, NewsThrottle throttle, IFileStorage files, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var post = await store.FindVisibleAsync(id, v, ct);
        if (post is null) return NoPost();
        if (post.CommentsDisabled || post.HiddenAt is not null) return Problems.Conflict("Bài viết này đã tắt bình luận");

        var text = NewsRules.NormalizeText(req.Text);
        var val = new Validation();
        foreach (var (f, m) in NewsRules.ValidateComment(text, req.UploadId is { } u && u != Guid.Empty)) val.Add(f, m);
        if (val.Failed) return val.Problem();

        Comment? parent = null;
        if (req.ParentId is { } pid)
        {
            parent = await db.Comments.AsNoTracking().FirstOrDefaultAsync(c => c.Id == pid && c.PostId == id && c.DeletedAt == null, ct);
            if (parent is null) return NoComment();
        }
        if (!throttle.TryAcquire(me, "comment", NewsRules.MinCommentInterval))
            return TypedResults.Problem("Gửi chậm lại một chút", statusCode: StatusCodes.Status429TooManyRequests);

        UploadTicket? ticket = null;
        if (req.UploadId is { } tid && tid != Guid.Empty)
        {
            ticket = await db.UploadTickets.FirstOrDefaultAsync(t => t.Id == tid && t.UserId == me && t.Kind == MediaKind.Image, ct);
            if (ticket is null) return new Validation().Add("uploadId", "Ảnh đính kèm không hợp lệ hoặc đã hết hạn — tải lại ảnh").Problem();
            // TEST-13: trước đây không kiểm file đã lên S3 / cỡ — chép key tạm → key chính + kiểm cỡ, chữ ký ảnh
            var check = await files.PromoteUploadAsync(ticket.FileKey, ticket.FileName, ct);
            if (check.Error is { } bad) return new Validation().Add("uploadId", bad).Problem();
            if (check.Size is not { } size) return Problems.Conflict("Ảnh chưa tải lên xong — thử lại");
            if (size <= 0 || size > NewsRules.MaxSizeOf(MediaKind.Image))
            {
                await files.DeleteAsync(ticket.FileKey, ct);
                return new Validation().Add("uploadId", "Ảnh vượt giới hạn dung lượng").Problem();
            }
        }

        var now = clock.GetUtcNow();
        var c = new Comment
        {
            PostId = id, ParentId = parent?.ParentId ?? parent?.Id, AuthorUserId = me, Text = text ?? "", CreatedAt = now,
            AuthorName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?",
        };
        if (ticket is not null)
        {
            c.ImageKey = ticket.FileKey; c.ImageName = ticket.FileName; c.ImageContentType = ticket.ContentType;
            db.UploadTickets.Remove(ticket);
        }
        db.Comments.Add(c);
        await db.SaveChangesAsync(ct);
        await store.RecountCommentsAsync(id, ct);

        // Thông báo (chỉ chuông): chủ bài, người được trả lời, người được @nhắc — mỗi người một thông báo
        var notified = new HashSet<Guid> { me };
        var link = $"/news/{id}?comment={c.Id}";
        var preview = text is null ? "[Ảnh]" : NewsRules.Preview(text, 120);
        if (notified.Add(post.AuthorUserId))
            await store.NotifyAsync([post.AuthorUserId], NotificationCategories.NewsComment, $"{c.AuthorName} đã bình luận bài viết của bạn", preview, link, false, ct);
        if (parent is not null && notified.Add(parent.AuthorUserId))
            await store.NotifyAsync([parent.AuthorUserId], NotificationCategories.NewsComment, $"{c.AuthorName} đã trả lời bình luận của bạn", preview, link, false, ct);
        var mentions = NewsRules.ExtractMentions(text).Where(notified.Add).Take(10).ToList();
        if (mentions.Count > 0)
            await store.NotifyAsync(await store.FilterVisibleAsync(post, mentions, ct), NotificationCategories.NewsMention,
                $"{c.AuthorName} đã nhắc đến bạn trong một bình luận", preview, link, false, ct);

        return TypedResults.Ok((await store.ToCommentDtosAsync([c], v, false, ct))[0]);
    }

    private static async Task<Results<Ok<CommentDto>, ProblemHttpResult, ValidationProblem>> EditAsync(Guid id, EditCommentRequest req, ClaimsPrincipal user,
        NewsDbContext db, NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var c = await db.Comments.FirstOrDefaultAsync(x => x.Id == id && x.AuthorUserId == me && x.DeletedAt == null, ct);
        if (c is null || await store.FindVisibleAsync(c.PostId, v, ct) is null) return NoComment();
        if (c.HiddenAt is not null) return Problems.Conflict("Bình luận đã bị ẩn bởi quản trị");
        var text = NewsRules.NormalizeText(req.Text);
        var val = new Validation();
        foreach (var (f, m) in NewsRules.ValidateComment(text, c.ImageKey is not null)) val.Add(f, m);
        if (val.Failed) return val.Problem();
        c.Text = text ?? "";
        c.EditedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await store.ToCommentDtosAsync([c], v, false, ct))[0]);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var c = await db.Comments.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (c is null) return NoComment();
        var post = await store.FindVisibleAsync(c.PostId, v, ct);
        // Xoá được: chính chủ, chủ bài (dọn bình luận trên bài mình), HR
        if (post is null || (c.AuthorUserId != me && post.AuthorUserId != me && !v.IsHr)) return NoComment();
        c.DeletedAt = clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        await store.RecountCommentsAsync(c.PostId, ct);
        if (c.AuthorUserId != me)
            await store.NotifyAsync([c.AuthorUserId], NotificationCategories.NewsModerated, "Bình luận của bạn đã bị gỡ",
                $"Bình luận \"{NewsRules.Preview(c.Text, 80)}\" đã bị gỡ khỏi bài viết.", $"/news/{c.PostId}", false, ct);
        return TypedResults.NoContent();
    }

    // ---------------- Cảm xúc (dùng chung cho bài + bình luận) ----------------

    private static async Task<Results<Ok<ReactionSummary>, ProblemHttpResult>> ReactAsync(Guid id, ReactionRequest req, ClaimsPrincipal user, NewsDbContext db,
        NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        if (!Enum.IsDefined(req.Type) || await VisibleCommentAsync(id, user, db, store, ct) is null) return NoComment();
        await SetReactionAsync(db, store, TargetType.Comment, id, me, req.Type, clock.GetUtcNow(), ct);
        return TypedResults.Ok(await SummaryAsync(db, TargetType.Comment, id, me, ct));
    }

    private static async Task<Results<Ok<ReactionSummary>, ProblemHttpResult>> UnreactAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store, CancellationToken ct)
    {
        var me = Me(user);
        if (await VisibleCommentAsync(id, user, db, store, ct) is null) return NoComment();
        await db.Reactions.Where(r => r.TargetType == TargetType.Comment && r.TargetId == id && r.UserId == me).ExecuteDeleteAsync(ct);
        await store.RecountReactionsAsync(TargetType.Comment, id, ct);
        return TypedResults.Ok(await SummaryAsync(db, TargetType.Comment, id, me, ct));
    }

    private static async Task<Results<Ok<List<ReactorDto>>, ProblemHttpResult>> ReactorsAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        IAccountService accounts, CancellationToken ct)
    {
        if (await VisibleCommentAsync(id, user, db, store, ct) is null) return NoComment();
        return TypedResults.Ok(await ReactorsOfAsync(db, accounts, TargetType.Comment, id, ct));
    }

    private static async Task<Comment?> VisibleCommentAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store, CancellationToken ct)
    {
        var c = await db.Comments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        if (c is null) return null;
        var v = await store.ViewerAsync(Me(user), user.IsHr(), ct);
        return await store.FindVisibleAsync(c.PostId, v, ct) is null ? null : c;
    }

    internal static async Task SetReactionAsync(NewsDbContext db, NewsStore store, TargetType type, Guid id, Guid me, ReactionType reaction, DateTimeOffset now, CancellationToken ct)
    {
        var r = await db.Reactions.FirstOrDefaultAsync(x => x.TargetType == type && x.TargetId == id && x.UserId == me, ct);
        if (r is null) db.Reactions.Add(new Reaction { TargetType = type, TargetId = id, UserId = me, Type = reaction, CreatedAt = now });
        else r.Type = reaction;
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // hai lần bấm đua nhau — dòng của lần kia đã đủ
        await store.RecountReactionsAsync(type, id, ct);
    }

    internal static async Task<ReactionSummary> SummaryAsync(NewsDbContext db, TargetType type, Guid id, Guid me, CancellationToken ct)
    {
        var rows = await db.Reactions.AsNoTracking().Where(r => r.TargetType == type && r.TargetId == id).GroupBy(r => r.Type).Select(g => new { g.Key, N = g.Count() }).ToListAsync(ct);
        var mine = await db.Reactions.AsNoTracking().Where(r => r.TargetType == type && r.TargetId == id && r.UserId == me).Select(r => (ReactionType?)r.Type).FirstOrDefaultAsync(ct);
        return new ReactionSummary(rows.Sum(x => x.N), rows.ToDictionary(x => x.Key, x => x.N), mine);
    }

    internal static async Task<List<ReactorDto>> ReactorsOfAsync(NewsDbContext db, IAccountService accounts, TargetType type, Guid id, CancellationToken ct)
    {
        var rows = await db.Reactions.AsNoTracking().Where(r => r.TargetType == type && r.TargetId == id).OrderByDescending(r => r.CreatedAt).Take(100).ToListAsync(ct);
        var names = await accounts.GetManyAsync(rows.Select(r => r.UserId).ToList(), ct);
        return rows.Select(r => new ReactorDto(r.UserId, names.TryGetValue(r.UserId, out var a) ? (string.IsNullOrWhiteSpace(a.FullName) ? a.UserName : a.FullName) : "Người dùng", r.Type)).ToList();
    }
}
