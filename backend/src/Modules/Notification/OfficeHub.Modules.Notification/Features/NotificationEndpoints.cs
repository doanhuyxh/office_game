using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Modules.Notification.Infrastructure;

namespace OfficeHub.Modules.Notification.Features;

public sealed record NotificationDto(Guid Id, string Category, string Title, string Body, string? Link, DateTimeOffset CreatedAt, bool Read);
public sealed record NotificationListDto(int UnreadCount, IReadOnlyList<NotificationDto> Items);
public sealed record UnreadCountDto(int Count);

/// <summary>Thông báo in-app của tài khoản đang đăng nhập (mọi truy vấn lọc theo UserId của chính người gọi).</summary>
internal static class NotificationEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/", ListAsync);
        g.MapGet("/unread-count", UnreadCountAsync);
        g.MapPost("/{id:guid}/read", ReadAsync);
        g.MapPost("/read-all", ReadAllAsync);
    }

    private static async Task<Ok<NotificationListDto>> ListAsync(int? take, ClaimsPrincipal user, NotificationDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var n = Math.Clamp(take ?? 20, 1, 100);
        var items = await db.Notifications.AsNoTracking().Where(x => x.UserId == uid).OrderByDescending(x => x.CreatedAt).Take(n)
            .Select(x => new NotificationDto(x.Id, x.Category, x.Title, x.Body, x.Link, x.CreatedAt, x.ReadAt != null)).ToListAsync(ct);
        var unread = await db.Notifications.CountAsync(x => x.UserId == uid && x.ReadAt == null, ct);
        return TypedResults.Ok(new NotificationListDto(unread, items));
    }

    private static async Task<Ok<UnreadCountDto>> UnreadCountAsync(ClaimsPrincipal user, NotificationDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        return TypedResults.Ok(new UnreadCountDto(await db.Notifications.CountAsync(x => x.UserId == uid && x.ReadAt == null, ct)));
    }

    /// <summary>Thông báo của người khác → 404 (không lộ là có tồn tại).</summary>
    private static async Task<Results<NoContent, NotFound>> ReadAsync(Guid id, ClaimsPrincipal user, NotificationDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var n = await db.Notifications.FirstOrDefaultAsync(x => x.Id == id && x.UserId == uid, ct);
        if (n is null) return TypedResults.NotFound();
        n.ReadAt ??= clock.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static async Task<NoContent> ReadAllAsync(ClaimsPrincipal user, NotificationDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var uid = user.GetUserId()!.Value;
        var now = clock.GetUtcNow();
        await db.Notifications.Where(x => x.UserId == uid && x.ReadAt == null).ExecuteUpdateAsync(s => s.SetProperty(x => x.ReadAt, now), ct);
        return TypedResults.NoContent();
    }
}
