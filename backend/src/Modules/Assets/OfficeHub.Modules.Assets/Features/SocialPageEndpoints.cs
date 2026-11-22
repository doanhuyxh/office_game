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
        var count = await db.SocialPagePosts.CountAsync(p => p.PageId == page.Id, ct);
        return new(SocialAccountEndpoints.ToDto(page, account.Name), account.Status, account.TokenStatus, holder?.FullName, page.PostsSyncedAt?.ToUniversalTime(),
            page.PostsSyncError, SocialService.IsSyncingPosts(page.Id), count, page.IsActive && page.TokenEncrypted is not null);
    }

    private static async Task<Results<Ok<SocialPageDetailDto>, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, CancellationToken ct) =>
        await FindAsync(id, user, db, access, false, ct) is { } f ? TypedResults.Ok(await DetailAsync(f.Page, db, access, ct)) : Problems.NotFound("trang");

    /// <summary>Bài đã đồng bộ, mới nhất trước; cờ "đăng từ OfficeHub" theo đích có cùng ID bài trên trang.</summary>
    private static async Task<Results<Ok<PagedResult<SocialPagePostDto>>, ProblemHttpResult>> PostsAsync(Guid id, int? page, int? pageSize,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        if (await FindAsync(id, user, db, access, false, ct) is not { } f) return Problems.NotFound("trang");
        var rows = await db.SocialPagePosts.AsNoTracking().Where(p => p.PageId == f.Page.Id).OrderByDescending(p => p.CreatedTime).ThenByDescending(p => p.Id)
            .ToPagedAsync(page ?? 1, pageSize, ct);
        var ext = rows.Items.Select(p => p.ExternalPostId).ToList();
        var targets = (await db.SocialTargets.AsNoTracking().Where(t => t.PageId == f.Page.Id && t.ExternalPostId != null && ext.Contains(t.ExternalPostId))
            .Select(t => new { t.ExternalPostId, t.PostId }).ToListAsync(ct)).DistinctBy(t => t.ExternalPostId).ToDictionary(t => t.ExternalPostId!, t => t.PostId);
        return TypedResults.Ok(rows.With<SocialPagePost, SocialPagePostDto>([.. rows.Items.Select(p =>
        {
            Guid? postId = targets.TryGetValue(p.ExternalPostId, out var pid) ? pid : null;
            return new SocialPagePostDto(p.Id, p.ExternalPostId, p.Message, p.CreatedTime, p.Permalink, p.PictureUrl, p.StatusType, p.ReactionCount,
                p.CommentCount, p.ShareCount, p.SyncedAt, postId is not null || p.PostTargetId is not null, postId);
        })]));
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
