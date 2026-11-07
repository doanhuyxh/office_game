using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using static OfficeHub.Modules.News.Features.PostEndpoints;

namespace OfficeHub.Modules.News.Features;

/// <summary>
/// HR / admin: ẩn / hiện bài và bình luận (bắt buộc lý do, báo cho tác giả), ghim bài toàn công ty. HR chỉ kiểm duyệt được nội dung mình
/// xem được — bài "Chỉ mình tôi" / danh sách riêng không có đường vào (như tin nhắn 1-1).
/// </summary>
public static class AdminEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapPost("/posts/{id:guid}/hide", HidePostAsync);
        g.MapPost("/posts/{id:guid}/unhide", UnhidePostAsync);
        g.MapPost("/posts/{id:guid}/pin", PinAsync);
        g.MapPost("/posts/{id:guid}/unpin", UnpinAsync);
        g.MapPost("/comments/{id:guid}/hide", HideCommentAsync);
        g.MapPost("/comments/{id:guid}/unhide", UnhideCommentAsync);
    }

    private static async Task<Results<NoContent, ProblemHttpResult, ValidationProblem>> HidePostAsync(Guid id, ModerateRequest req, ClaimsPrincipal user,
        NewsDbContext db, NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var reason = req.Reason?.Trim();
        if (string.IsNullOrEmpty(reason)) return new Validation().Add("reason", "Nhập lý do ẩn bài").Problem();
        var me = Me(user);
        var v = await store.ViewerAsync(me, true, ct);
        var p = await store.FindVisibleAsync(id, v, ct, track: true);
        if (p is null) return NoPost();
        if (p.HiddenAt is null)
        {
            p.HiddenAt = clock.GetUtcNow(); p.HiddenReason = reason.Length > 500 ? reason[..500] : reason; p.HiddenByUserId = me; p.PinnedUntil = null;
            await db.SaveChangesAsync(ct);
            if (p.AuthorUserId != me)
                await store.NotifyAsync([p.AuthorUserId], NotificationCategories.NewsModerated, "Bài viết của bạn đã bị ẩn",
                    $"Lý do: {p.HiddenReason}", $"/news/{p.Id}", false, ct);
        }
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> UnhidePostAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store, CancellationToken ct)
    {
        var v = await store.ViewerAsync(Me(user), true, ct);
        var p = await store.FindVisibleAsync(id, v, ct, track: true);
        if (p is null) return NoPost();
        p.HiddenAt = null; p.HiddenReason = null; p.HiddenByUserId = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> PinAsync(Guid id, PinRequest? req, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        TimeProvider clock, CancellationToken ct)
    {
        var v = await store.ViewerAsync(Me(user), true, ct);
        var p = await store.FindVisibleAsync(id, v, ct, track: true);
        if (p is null) return NoPost();
        if (p.Audience != PostAudience.Company || p.HiddenAt is not null) return Problems.Conflict("Chỉ ghim được bài đang hiển thị với toàn công ty");
        p.PinnedUntil = clock.GetUtcNow().AddDays(Math.Clamp(req?.Days ?? 7, 1, 90));
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> UnpinAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store, CancellationToken ct)
    {
        var v = await store.ViewerAsync(Me(user), true, ct);
        var p = await store.FindVisibleAsync(id, v, ct, track: true);
        if (p is null) return NoPost();
        p.PinnedUntil = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult, ValidationProblem>> HideCommentAsync(Guid id, ModerateRequest req, ClaimsPrincipal user,
        NewsDbContext db, NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var reason = req.Reason?.Trim();
        if (string.IsNullOrEmpty(reason)) return new Validation().Add("reason", "Nhập lý do ẩn bình luận").Problem();
        var me = Me(user);
        var c = await db.Comments.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        var v = await store.ViewerAsync(me, true, ct);
        if (c is null || await store.FindVisibleAsync(c.PostId, v, ct) is null) return Problems.NotFound("bình luận");
        if (c.HiddenAt is null)
        {
            c.HiddenAt = clock.GetUtcNow(); c.HiddenReason = reason.Length > 500 ? reason[..500] : reason; c.HiddenByUserId = me;
            await db.SaveChangesAsync(ct);
            if (c.AuthorUserId != me)
                await store.NotifyAsync([c.AuthorUserId], NotificationCategories.NewsModerated, "Bình luận của bạn đã bị ẩn",
                    $"Lý do: {c.HiddenReason}", $"/news/{c.PostId}", false, ct);
        }
        return TypedResults.NoContent();
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> UnhideCommentAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store, CancellationToken ct)
    {
        var c = await db.Comments.FirstOrDefaultAsync(x => x.Id == id && x.DeletedAt == null, ct);
        var v = await store.ViewerAsync(Me(user), true, ct);
        if (c is null || await store.FindVisibleAsync(c.PostId, v, ct) is null) return Problems.NotFound("bình luận");
        c.HiddenAt = null; c.HiddenReason = null; c.HiddenByUserId = null;
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }
}
