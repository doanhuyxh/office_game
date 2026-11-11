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

/// <param name="Kind">Created | Moved | Assigned | DueChanged | Edited | Depends | Commented.</param>
/// <param name="Member">Người xem là thành viên dự án — FE chỉ hiện toast cho dự án mình tham gia (HR / người xem tài chính thấy mọi dự án nhưng không bị làm phiền).</param>
public sealed record ActivityItemDto(Guid Id, Guid ProjectId, string ProjectName, Guid TaskId, string TaskCode, string TaskTitle, string Kind,
    string? From, string? To, string? Text, string ActorName, bool ByBot, DateTimeOffset At, bool Member);
/// <param name="Cursor">Gửi lại làm <c>after</c> ở lần hỏi kế; FE bỏ trùng theo <c>id</c> (cửa sổ chồng lấn để không sót bản ghi ghi muộn).</param>
public sealed record ActivityFeedDto(DateTimeOffset Cursor, IReadOnlyList<ActivityItemDto> Items);

/// <summary>
/// Thay đổi gần đây ở các dự án người xem thấy được (2026-11-11 — bảng việc tự cập nhật + toast khi đang ở trang khác).
/// FE hỏi định kỳ (5 giây, chỉ khi tab đang mở) với con trỏ thời gian; không có <c>after</c> → chỉ trả con trỏ (bắt đầu theo dõi từ bây giờ).
/// Bỏ thao tác của chính người xem. Token AI không gọi được (không có trong danh sách cho phép).
/// </summary>
internal static class ActivityFeedEndpoints
{
    public const int MaxItems = 50;
    /// <summary>Cửa sổ lùi khi không có bản ghi mới: bản ghi có At trước lúc hỏi nhưng lưu xong sau đó vẫn được lấy ở lần kế.</summary>
    private static readonly TimeSpan Overlap = TimeSpan.FromSeconds(10);

    public static void Map(RouteGroupBuilder g) => g.MapGet("/activity", FeedAsync);

    private static async Task<Results<Ok<ActivityFeedDto>, ValidationProblem>> FeedAsync(string? after, ClaimsPrincipal user, ProjectsDbContext db,
        ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        var now = clock.Now;
        if (string.IsNullOrWhiteSpace(after)) return TypedResults.Ok(new ActivityFeedDto(now, []));
        if (!Instants.TryParse(after, out var since)) return new Validation().Add("after", Instants.MissingZoneMessage).Problem();
        if (now - since > TimeSpan.FromHours(1)) since = now - TimeSpan.FromHours(1); // tab ngủ lâu: chỉ lấy 1 giờ gần nhất

        var v = await access.ViewerAsync(user, ct);
        var all = v.IsHr || v.FinanceView;
        var memberOf = v.Roles.Keys.ToList();
        if (!all && memberOf.Count == 0) return TypedResults.Ok(new ActivityFeedDto(now, []));
        var me = v.Employee?.Id;

        var tasks = db.Tasks.AsNoTracking().Where(t => all || memberOf.Contains(t.ProjectId));
        var acts = await (from a in db.Activities.AsNoTracking()
                          join t in tasks on a.TaskId equals t.Id
                          where a.At > since && (me == null ? a.ActorName != v.Name || a.ByBot : a.ActorEmployeeId != me || a.ByBot)
                          orderby a.At descending
                          select new { a.Id, t.ProjectId, TaskId = t.Id, t.Number, t.Title, Kind = a.Kind.ToString(), a.From, a.To, Text = a.Note, a.ActorName, a.ByBot, a.At })
            .Take(MaxItems).ToListAsync(ct);
        var comments = await (from c in db.Comments.AsNoTracking()
                              join t in tasks on c.TaskId equals t.Id
                              where c.CreatedAt > since && (me == null ? c.AuthorName != v.Name || c.ByBot : c.AuthorEmployeeId != me || c.ByBot)
                              orderby c.CreatedAt descending
                              select new { c.Id, t.ProjectId, TaskId = t.Id, t.Number, t.Title, Kind = "Commented", From = (string?)null, To = (string?)null,
                                  Text = (string?)c.Content, ActorName = c.AuthorName, c.ByBot, At = c.CreatedAt })
            .Take(MaxItems).ToListAsync(ct);
        // Lý do khi chuyển lùi vừa là lịch sử Moved vừa là bình luận (cùng thời điểm) → bỏ bình luận trùng.
        var movedAt = acts.Where(a => a.Kind == nameof(TaskActivityKind.Moved) && a.Text != null).Select(a => (a.TaskId, a.At)).ToHashSet();
        var rows = acts.Concat(comments.Where(c => !movedAt.Contains((c.TaskId, c.At)))).OrderBy(x => x.At).TakeLast(MaxItems).ToList();
        if (rows.Count == 0) return TypedResults.Ok(new ActivityFeedDto(Max(since, now - Overlap), []));

        var projectIds = rows.Select(r => r.ProjectId).Distinct().ToList();
        var projects = await db.Projects.AsNoTracking().Where(p => projectIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => new { p.Code, p.Name }, ct);
        var items = rows.Select(r => new ActivityItemDto(r.Id, r.ProjectId, projects[r.ProjectId].Name, r.TaskId, EffortRules.TaskCode(projects[r.ProjectId].Code, r.Number),
            r.Title, r.Kind, r.From, r.To, r.Text is { Length: > 200 } s ? s[..200] + "…" : r.Text, r.ActorName, r.ByBot, r.At, v.IsMember(r.ProjectId))).ToList();
        return TypedResults.Ok(new ActivityFeedDto(Max(rows[^1].At - Overlap, since), items));
    }

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;
}
