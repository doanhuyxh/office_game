using Microsoft.AspNetCore.Builder;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>
/// Rà soát quyền truy cập định kỳ: HR chụp mọi ghế đang dùng → quản lý trực tiếp (không có → HR) chọn giữ / thu hồi → HR đóng đợt thì
/// các ghế "thu hồi" mới bị thu hồi thật.
/// </summary>
internal static class ReviewEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/reviews/pending", PendingAsync).RequireAuthorization();
        g.MapPost("/reviews/items/{itemId:guid}/decide", DecideAsync).RequireAuthorization();
        var hr = g.MapGroup("/reviews").RequireAuthorization(AuthPolicies.Hr);
        hr.MapGet("", ListAsync);
        hr.MapPost("", StartAsync);
        hr.MapGet("/{id:guid}", GetAsync);
        hr.MapPost("/{id:guid}/close", CloseAsync);
    }

    private static ReviewDto ToDto(AccessReview r, int total, int decided, int toRevoke) =>
        new(r.Id, r.Title, r.Status, r.DueDate, r.StartedAt, r.StartedByName, r.ClosedAt, total, decided, toRevoke);

    private static ReviewItemDto ToDto(AccessReviewItem i, string reviewTitle, IReadOnlyDictionary<Guid, EmployeeRef> emps)
    {
        var e = emps.GetValueOrDefault(i.EmployeeId);
        var rv = i.ReviewerEmployeeId is { } rid ? emps.GetValueOrDefault(rid) : null;
        return new(i.Id, i.ReviewId, reviewTitle, i.SeatId, i.ServiceName, i.AccountLogin, i.EmployeeId, e?.FullName ?? "(không rõ)", e?.Code ?? "",
            i.ReviewerEmployeeId, rv?.FullName, i.Decision, i.Note, i.DecidedAt, i.DecidedByName);
    }

    private static async Task<Ok<List<ReviewDto>>> ListAsync(AssetsDbContext db, CancellationToken ct)
    {
        var rows = await db.Reviews.AsNoTracking().OrderByDescending(r => r.StartedAt).ToListAsync(ct);
        var stats = await db.ReviewItems.AsNoTracking().GroupBy(i => i.ReviewId).Select(g => new
        {
            g.Key, Total = g.Count(), Decided = g.Count(i => i.Decision != ReviewDecision.Pending), Revoke = g.Count(i => i.Decision == ReviewDecision.Revoke),
        }).ToDictionaryAsync(x => x.Key, ct);
        return TypedResults.Ok(rows.Select(r => stats.TryGetValue(r.Id, out var s) ? ToDto(r, s.Total, s.Decided, s.Revoke) : ToDto(r, 0, 0, 0)).ToList());
    }

    private static async Task<Results<Ok<ReviewDetailDto>, ProblemHttpResult>> GetAsync(Guid id, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var r = await db.Reviews.AsNoTracking().Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return Problems.NotFound("đợt rà soát");
        var emps = await access.EmployeesAsync(ct);
        var items = r.Items.OrderBy(i => i.ServiceName).ThenBy(i => i.AccountLogin).Select(i => ToDto(i, r.Title, emps)).ToList();
        return TypedResults.Ok(new ReviewDetailDto(ToDto(r, items.Count, items.Count(i => i.Decision != ReviewDecision.Pending),
            items.Count(i => i.Decision == ReviewDecision.Revoke)), items));
    }

    private static async Task<Results<Ok<ReviewDto>, ValidationProblem, ProblemHttpResult>> StartAsync(ReviewStartRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetOps ops, IEmployeeDirectory dir, IAccountService accounts, AssetClock clock, CancellationToken ct)
    {
        var title = string.IsNullOrWhiteSpace(req.Title) ? $"Rà soát quyền truy cập {clock.Today:MM/yyyy}" : req.Title.Trim();
        var v = new Validation().MaxLength(title, 200, "title", "Tiêu đề")
            .When(req.DueDate is null, "dueDate", "Chọn hạn hoàn thành")
            .When(req.DueDate is { } d && d < clock.Today, "dueDate", "Hạn hoàn thành không được ở quá khứ");
        if (v.Failed) return v.Problem();
        if (await db.Reviews.AnyAsync(r => r.Status == ReviewStatus.Open, ct)) return Problems.Conflict("Đang có một đợt rà soát chưa đóng");

        var q = from s in db.Seats.AsNoTracking()
                join sv in db.Services.AsNoTracking() on s.ServiceId equals sv.Id
                where s.RevokedAt == null && sv.Status == ServiceStatus.Active && (req.ServiceId == null || sv.Id == req.ServiceId)
                select new { Seat = s, ServiceName = sv.Name };
        var seats = await q.ToListAsync(ct);
        if (seats.Count == 0) return Problems.Conflict("Không có tài khoản nào đang dùng để rà soát");

        var emps = await access.EmployeesAsync(ct);
        var me = await access.ViewerAsync(user, ct);
        var review = new AccessReview { Title = title, DueDate = req.DueDate!.Value, Status = ReviewStatus.Open, StartedAt = clock.Now, StartedByName = me.Name };
        foreach (var x in seats)
        {
            var mgr = emps.GetValueOrDefault(x.Seat.EmployeeId)?.ManagerId is { } m && emps.GetValueOrDefault(m) is { IsActive: true } ? m : (Guid?)null;
            review.Items.Add(new AccessReviewItem
            {
                SeatId = x.Seat.Id, ServiceId = x.Seat.ServiceId, ServiceName = x.ServiceName, AccountLogin = x.Seat.AccountLogin,
                EmployeeId = x.Seat.EmployeeId, ReviewerEmployeeId = mgr,
            });
        }
        db.Reviews.Add(review);
        await db.SaveChangesAsync(ct);

        foreach (var grp in review.Items.Where(i => i.ReviewerEmployeeId is not null).GroupBy(i => i.ReviewerEmployeeId!.Value))
            await ops.NotifyEmployeeAsync(grp.Key, NotificationCategories.AssetReview, $"Cần rà soát {grp.Count()} tài khoản dịch vụ của nhóm bạn",
                $"{title}. Hạn: {review.DueDate:dd/MM/yyyy}. Mở Tài sản → Của tôi để chọn giữ hoặc thu hồi.", email: true);
        if (review.Items.Any(i => i.ReviewerEmployeeId is null))
        {
            var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
            if (hr.Count == 0) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
            await ops.NotifyUsersAsync([.. hr.Select(a => a.Id)], NotificationCategories.AssetReview,
                $"Có {review.Items.Count(i => i.ReviewerEmployeeId is null)} tài khoản dịch vụ cần HR rà soát",
                $"{title}. Hạn: {review.DueDate:dd/MM/yyyy}.");
        }
        return TypedResults.Ok(ToDto(review, review.Items.Count, 0, 0));
    }

    private static async Task<Ok<List<ReviewItemDto>>> PendingAsync(ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var myId = me.Employee?.Id;
        var rows = await (from i in db.ReviewItems.AsNoTracking()
                          join r in db.Reviews.AsNoTracking() on i.ReviewId equals r.Id
                          where r.Status == ReviewStatus.Open && i.Decision == ReviewDecision.Pending
                                && ((myId != null && i.ReviewerEmployeeId == myId) || (me.IsHr && i.ReviewerEmployeeId == null))
                          orderby i.ServiceName, i.AccountLogin
                          select new { Item = i, r.Title }).ToListAsync(ct);
        var emps = await access.EmployeesAsync(ct);
        return TypedResults.Ok(rows.Select(x => ToDto(x.Item, x.Title, emps)).ToList());
    }

    private static async Task<Results<Ok<ReviewItemDto>, ValidationProblem, ProblemHttpResult>> DecideAsync(Guid itemId, DecideRequest req, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var item = await db.ReviewItems.FirstOrDefaultAsync(i => i.Id == itemId, ct);
        var review = item is null ? null : await db.Reviews.AsNoTracking().FirstOrDefaultAsync(r => r.Id == item.ReviewId, ct);
        var me = await access.ViewerAsync(user, ct);
        // Không phải người rà soát (và không phải HR) → 404, không lộ mục này tồn tại
        if (item is null || review is null || !(me.IsHr || (me.Employee is not null && item.ReviewerEmployeeId == me.Employee.Id)))
            return Problems.NotFound("mục rà soát");
        if (review.Status != ReviewStatus.Open) return Problems.Conflict("Đợt rà soát đã đóng");
        var v = new Validation()
            .When(req.Decision == ReviewDecision.Pending, "decision", "Chọn Giữ hoặc Thu hồi")
            .MaxLength(req.Note?.Trim(), 1000, "note", "Ghi chú");
        if (v.Failed) return v.Problem();
        item.Decision = req.Decision;
        item.Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim();
        item.DecidedAt = clock.Now;
        item.DecidedByName = me.Name;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(item, review.Title, await access.EmployeesAsync(ct)));
    }

    private static async Task<Results<Ok<ReviewDto>, ProblemHttpResult>> CloseAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        AssetOps ops, AssetClock clock, CancellationToken ct)
    {
        var r = await db.Reviews.Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return Problems.NotFound("đợt rà soát");
        if (r.Status == ReviewStatus.Closed) return Problems.Conflict("Đợt rà soát đã đóng");
        var me = await access.ViewerAsync(user, ct);
        var seatIds = r.Items.Where(i => i.Decision == ReviewDecision.Revoke).Select(i => i.SeatId).ToList();
        var seats = await db.Seats.Where(s => seatIds.Contains(s.Id) && s.RevokedAt == null).ToListAsync(ct);
        var names = r.Items.ToDictionary(i => i.SeatId, i => i.ServiceName);
        foreach (var s in seats) ops.Revoke(s, me.Name);
        r.Status = ReviewStatus.Closed;
        r.ClosedAt = clock.Now;
        r.ClosedByName = me.Name;
        await db.SaveChangesAsync(ct);
        foreach (var s in seats)
            await ops.NotifyEmployeeAsync(s.EmployeeId, NotificationCategories.AssetReturned, $"Tài khoản {names.GetValueOrDefault(s.Id)} đã bị thu hồi",
                $"Sau đợt rà soát \"{r.Title}\", tài khoản {s.AccountLogin} không còn được cấp cho bạn.", email: false);
        return TypedResults.Ok(ToDto(r, r.Items.Count, r.Items.Count(i => i.Decision != ReviewDecision.Pending), r.Items.Count(i => i.Decision == ReviewDecision.Revoke)));
    }
}
