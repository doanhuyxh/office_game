using System.Collections.Concurrent;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Projects.Domain;
using OfficeHub.Modules.Projects.Infrastructure;

namespace OfficeHub.Modules.Projects.Features;

public sealed record NewWikiSharePage(Guid PageId, bool IncludeChildren = false);
/// <param name="Scope">"all" (toàn bộ sổ tay) | "pages" (trang được chọn — mặc định).</param>
/// <param name="Pages">Bắt buộc khi scope = pages: 1–200 trang, không trùng, cùng dự án, chưa xoá.</param>
/// <param name="PageId">Cách viết tắt cũ (TEST-228) cho MỘT trang khi không gửi <paramref name="Pages"/>.</param>
/// <param name="Days">1 / 7 / 30 (bỏ trống và không có <paramref name="ExpiresOn"/> = 7).</param>
/// <param name="ExpiresOn">Ngày tự chọn (giờ văn phòng) — link hết hiệu lực khi hết ngày đó; ≤ 90 ngày.</param>
/// <param name="Password">Tuỳ chọn, 4–100 ký tự — lưu dạng băm.</param>
public sealed record NewWikiShare(string? Scope = null, List<NewWikiSharePage>? Pages = null, Guid? PageId = null, bool IncludeChildren = false,
    int? Days = null, DateOnly? ExpiresOn = null, string? Label = null, string? RecipientName = null, string? Password = null);
/// <param name="Token">Chỉ trả MỘT lần lúc tạo (DB giữ hash) — FE dựng URL công khai <c>/s/{token}</c>.</param>
public sealed record WikiShareCreatedDto(Guid Id, string Token, DateTimeOffset ExpiresAt, WikiShareDto Share);
/// <param name="Title">Tiêu đề trang; trang đã xoá → "(trang đã xoá)" + <paramref name="Deleted"/>.</param>
public sealed record WikiSharePageDto(Guid Id, string Title, bool IncludeChildren, bool Deleted);
/// <param name="Scope">"all" | "pages".</param>
/// <param name="PageCount">Số trang được chọn (phạm vi pages; all = 0).</param>
/// <param name="Status">"active" | "expired" | "revoked" | "gone" (mọi trang được chọn đã xoá / dự án đóng).</param>
public sealed record WikiShareDto(Guid Id, string Scope, int PageCount, List<WikiSharePageDto> Pages, string? Label, string? RecipientName, bool HasPassword,
    DateTimeOffset ExpiresAt, DateTimeOffset? RevokedAt, string? RevokedByName, DateTimeOffset CreatedAt, string CreatedByName, int ViewCount,
    DateTimeOffset? LastViewedAt, string Status);
public sealed record WikiShareViewItem(DateTimeOffset At, string? Ip, string? UserAgent);
public sealed record WikiShareViewList(List<WikiShareViewItem> Items, int Total, int Page, int PageSize);

public sealed record PublicWikiShareNode(Guid Id, Guid? ParentId, string Title);
/// <param name="RootPageId">Trang mở đầu tiên (trang đầu của cây); cây rỗng (phạm vi all, sổ tay trống) → null.</param>
/// <param name="Locked">Cần mật khẩu mà chưa mở khoá → <paramref name="Pages"/> rỗng, <paramref name="RootPageId"/> null.</param>
public sealed record PublicWikiShareDto(string ProjectName, Guid? RootPageId, List<PublicWikiShareNode> Pages, DateTimeOffset ExpiresAt, string? RecipientName,
    bool RequiresPassword, bool Locked, string NotSharedHref);
public sealed record PublicWikiCrumb(Guid Id, string Title);
/// <param name="Content">Markdown đã đổi link: trang trong bản chia sẻ → <c>/s/{token}?page={id}</c>, trang ngoài → <c>wiki-share:not-shared</c>.</param>
public sealed record PublicWikiPageDto(Guid Id, Guid? ParentId, string Title, string? Summary, string Content, DateTimeOffset UpdatedAt, List<PublicWikiCrumb> Path);
public sealed record WikiShareUnlock(string? Password);

/// <summary>
/// Đếm lần nhập sai mật khẩu link chia sẻ sổ tay (trong bộ nhớ, một tiến trình Api): theo (link, IP) và theo link, cửa sổ <see cref="WikiShareRules.FailureWindow"/>.
/// Khởi động lại Api thì đếm lại từ đầu (chấp nhận được: rate-limit theo IP vẫn còn).
/// </summary>
internal sealed class WikiShareUnlockGuard(TimeProvider clock)
{
    private readonly ConcurrentDictionary<string, List<DateTimeOffset>> _fails = new();

    private int Count(string key, DateTimeOffset now)
    {
        if (!_fails.TryGetValue(key, out var list)) return 0;
        lock (list)
        {
            list.RemoveAll(t => now - t >= WikiShareRules.FailureWindow);
            return list.Count;
        }
    }

    private void Add(string key, DateTimeOffset now)
    {
        var list = _fails.GetOrAdd(key, _ => []);
        lock (list) list.Add(now);
    }

    public bool Blocked(Guid linkId, string? ip)
    {
        var now = clock.GetUtcNow();
        if (_fails.Count > 10_000) Sweep(now);
        return WikiShareRules.UnlockBlocked(Count($"{linkId}|{ip}", now), Count(linkId.ToString(), now));
    }

    public void Fail(Guid linkId, string? ip)
    {
        var now = clock.GetUtcNow();
        Add($"{linkId}|{ip}", now);
        Add(linkId.ToString(), now);
    }

    private void Sweep(DateTimeOffset now)
    {
        foreach (var k in _fails.Keys)
            if (Count(k, now) == 0) _fails.TryRemove(k, out _);
    }
}

/// <summary>
/// Chia sẻ công khai trang sổ tay có thời hạn (TEST-228). Quy tắc: <see cref="WikiShareRules"/>.
/// Quản lý: <c>/api/projects/{id}/wiki/shares</c> — quản lý dự án + HR trên web (token AI ngoài allowlist + endpoint tự chặn). Người không xem được dự án → 404.
/// Công khai: <c>/api/projects/public/wiki-shares/{token}</c> — AllowAnonymous, không dùng cookie đăng nhập, rate-limit theo IP,
/// header <c>X-Robots-Tag: noindex</c> + <c>Cache-Control: no-store</c>.
/// </summary>
internal static class WikiShareEndpoints
{
    public const string RateLimitPolicy = "projects-wiki-share";
    private const string ProtectorPurpose = "OfficeHub.Projects.WikiShare.Unlock";
    private const string CookiePrefix = "oh_wshare_";
    private const string CookiePath = "/api/projects/public/wiki-shares";
    private static readonly PasswordHasher<WikiShareLink> Hasher = new();

    public static void AddServices(IServiceCollection services)
    {
        services.AddSingleton<WikiShareUnlockGuard>();
        services.Configure<RateLimiterOptions>(o => o.AddPolicy(RateLimitPolicy, ctx => RateLimitPartition.GetFixedWindowLimiter(
            $"{ctx.Connection.RemoteIpAddress}|{ctx.Request.Path}",
            _ => new FixedWindowRateLimiterOptions { PermitLimit = WikiShareRules.PublicRequestsPerMinute, Window = TimeSpan.FromMinutes(1) })));
    }

    public static void Map(RouteGroupBuilder g)
    {
        var s = g.MapGroup("/{id:guid}/wiki/shares");
        s.MapPost("/", CreateAsync);
        s.MapGet("/", ListAsync);
        s.MapDelete("/{shareId:guid}", RevokeAsync);
        s.MapGet("/{shareId:guid}/views", ViewsAsync);
    }

    public static void MapPublic(RouteGroupBuilder g)
    {
        g.AddEndpointFilter(async (ctx, next) =>
        {
            var h = ctx.HttpContext.Response.Headers;
            h["X-Robots-Tag"] = "noindex, nofollow";
            h.CacheControl = "no-store";
            return await next(ctx);
        });
        g.MapGet("/{token}", InfoAsync);
        g.MapPost("/{token}/unlock", UnlockAsync);
        g.MapGet("/{token}/pages/{pageId:guid}", PageAsync);
    }

    // ---- Quản lý (web) ----

    private sealed record Ctx(ProjectViewer V, Project P, bool ByToken)
    {
        public WikiDenial? Manage() => WikiShareRules.ManageDenial(V.CanManage(P.Id), ByToken);
    }

    private static async Task<Ctx?> CtxAsync(Guid id, ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        var v = await access.ViewerAsync(user, ct);
        if (!v.CanSee(id)) return null;
        var p = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return p is null ? null : new Ctx(v, p, user.IsAccessToken());
    }

    private static ProblemHttpResult Deny(WikiDenial d) => TypedResults.Problem(d.Message, statusCode: d.Status);

    private static string StatusOf(WikiShareLink l, DateTimeOffset now, bool projectActive, bool hasContent) =>
        l.RevokedAt is not null ? "revoked" : l.ExpiresAt <= now ? "expired" : !projectActive || !hasContent ? "gone" : "active";

    /// <summary>Trang chưa xoá của dự án (để dựng cây chia sẻ).</summary>
    private static Task<List<WikiShareNode>> NodesAsync(ProjectsDbContext db, Guid projectId, CancellationToken ct) =>
        db.WikiPages.AsNoTracking().Where(x => x.ProjectId == projectId && x.DeletedAt == null)
            .Select(x => new WikiShareNode(x.Id, x.ParentId, x.Position, x.Title)).ToListAsync(ct);

    private static List<WikiShareSelection> SelectionOf(IEnumerable<WikiSharePage> rows) => rows.Select(x => new WikiShareSelection(x.PageId, x.IncludeChildren)).ToList();

    /// <param name="order">Id trang → thứ tự trong cây sổ tay (để liệt kê trang được chọn như trong sổ tay).</param>
    private static WikiShareDto ToDto(WikiShareLink l, List<WikiShareSelection> sel, int sharedCount, IReadOnlyDictionary<Guid, (int Order, string Title)> order,
        DateTimeOffset now, bool projectActive)
    {
        var pages = sel.Select(x => order.TryGetValue(x.PageId, out var o)
                ? (o.Order, Dto: new WikiSharePageDto(x.PageId, o.Title, x.IncludeChildren, false))
                : (int.MaxValue, Dto: new WikiSharePageDto(x.PageId, "(trang đã xoá)", x.IncludeChildren, true)))
            .OrderBy(x => x.Item1).Select(x => x.Dto).ToList();
        return new(l.Id, l.Scope, l.Scope == WikiShareRules.ScopeAll ? 0 : sel.Count, pages, l.Label, l.RecipientName, l.PasswordHash is not null, l.ExpiresAt,
            l.RevokedAt, l.RevokedByName, l.CreatedAt, l.CreatedByName, l.ViewCount, l.LastViewedAt,
            StatusOf(l, now, projectActive, WikiShareRules.HasContent(l.Scope, sharedCount)));
    }

    private static Dictionary<Guid, (int Order, string Title)> TreeOrder(IReadOnlyCollection<WikiShareNode> nodes) =>
        WikiShareRules.SharedPages(WikiShareRules.ScopeAll, [], nodes).Select((x, i) => (x, i)).ToDictionary(t => t.x.Id, t => (t.i, t.x.Title));

    private static async Task<Results<Ok<WikiShareCreatedDto>, NotFound, ValidationProblem, ProblemHttpResult>> CreateAsync(Guid id, NewWikiShare r,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (c.Manage() is { } d) return Deny(d);
        if (c.P.Status != ProjectStatus.Active) return Problems.Conflict("Dự án đã đóng — không tạo link chia sẻ");
        var now = clock.Now;
        var label = WikiShareRules.OneLine(r.Label);
        var recipient = WikiShareRules.OneLine(r.RecipientName);
        var val = new Validation()
            .MaxLength(label, WikiShareRules.MaxLabel, "label", "Nhãn")
            .MaxLength(recipient, WikiShareRules.MaxRecipient, "recipientName", "Người nhận");
        var (scope, selected, selErr) = WikiShareRules.Selection(r.Scope,
            r.Pages?.Select(x => new WikiShareSelection(x.PageId, x.IncludeChildren)).ToList(), r.PageId, r.IncludeChildren);
        var nodes = await NodesAsync(db, id, ct);
        var order = TreeOrder(nodes);
        if (selErr is { } se) val.Add(se.Field, se.Message);
        // Trang phải thuộc dự án, chưa xoá và còn hiện trong sổ tay (không nằm dưới trang đã xoá).
        else if (selected.Any(x => !order.ContainsKey(x.PageId))) val.Add(r.Pages is { Count: > 0 } ? "pages" : "pageId", "Trang không tồn tại trong sổ tay dự án");
        var (expiresAt, expErr) = WikiShareRules.ExpiresAt(r.Days, r.ExpiresOn, now, clock.EndOfDay);
        if (expErr is not null) val.Add(r.ExpiresOn is not null ? "expiresOn" : "days", expErr);
        if (WikiShareRules.PasswordError(r.Password) is { } pe) val.Add("password", pe);
        if (val.Failed) return val.Problem();
        var active = await db.WikiShareLinks.CountAsync(x => x.ProjectId == id && x.RevokedAt == null && x.ExpiresAt > now, ct);
        if (active >= WikiShareRules.MaxActivePerProject)
            return Problems.Conflict($"Dự án đã có {WikiShareRules.MaxActivePerProject} link chia sẻ còn hạn — thu hồi bớt rồi tạo mới");
        var token = UploadLinkRules.NewToken();
        var link = new WikiShareLink
        {
            ProjectId = id, Scope = scope, Label = label, RecipientName = recipient,
            TokenHash = UploadLinkRules.Hash(token), ExpiresAt = expiresAt!.Value, CreatedAt = now, CreatedByUserId = c.V.UserId, CreatedByName = c.V.Name,
        };
        if (!string.IsNullOrEmpty(r.Password)) link.PasswordHash = Hasher.HashPassword(link, r.Password);
        db.WikiShareLinks.Add(link);
        db.WikiSharePages.AddRange(selected.Select(x => new WikiSharePage { LinkId = link.Id, PageId = x.PageId, IncludeChildren = x.IncludeChildren }));
        await db.SaveChangesAsync(ct);
        var shared = WikiShareRules.SharedPages(scope, selected, nodes).Count;
        return TypedResults.Ok(new WikiShareCreatedDto(link.Id, token, link.ExpiresAt, ToDto(link, selected, shared, order, now, true)));
    }

    /// <summary>Mọi link của dự án (mới nhất trước); <paramref name="pageId"/> → chỉ link có chứa trang đó (kể cả qua "kèm con" / toàn bộ sổ tay). Không có token.</summary>
    private static async Task<Results<Ok<List<WikiShareDto>>, NotFound, ProblemHttpResult>> ListAsync(Guid id, Guid? pageId, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (c.Manage() is { } d) return Deny(d);
        var links = await db.WikiShareLinks.AsNoTracking().Where(x => x.ProjectId == id).OrderByDescending(x => x.CreatedAt).Take(500).ToListAsync(ct);
        var linkIds = links.Select(x => x.Id).ToList();
        var rows = (await db.WikiSharePages.AsNoTracking().Where(x => linkIds.Contains(x.LinkId)).ToListAsync(ct)).ToLookup(x => x.LinkId);
        var nodes = await NodesAsync(db, id, ct);
        var order = TreeOrder(nodes);
        var now = clock.Now;
        var active = c.P.Status == ProjectStatus.Active;
        var result = new List<WikiShareDto>();
        foreach (var l in links)
        {
            var sel = SelectionOf(rows[l.Id]);
            var shared = WikiShareRules.SharedPages(l.Scope, sel, nodes);
            if (pageId is { } pid && !shared.Any(x => x.Id == pid) && !sel.Any(x => x.PageId == pid)) continue;
            result.Add(ToDto(l, sel, shared.Count, order, now, active));
        }
        return TypedResults.Ok(result);
    }

    /// <summary>Thu hồi (204). Đã thu hồi → vẫn 204. Quản lý dự án / HR trên web (dự án đóng vẫn thu hồi được).</summary>
    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> RevokeAsync(Guid id, Guid shareId, ClaimsPrincipal user,
        ProjectsDbContext db, ProjectAccess access, ProjectClock clock, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        if (c.Manage() is { } d) return Deny(d);
        var link = await db.WikiShareLinks.FirstOrDefaultAsync(x => x.Id == shareId && x.ProjectId == id, ct);
        if (link is null) return TypedResults.NotFound();
        if (link.RevokedAt is null)
        {
            link.RevokedAt = clock.Now;
            link.RevokedByName = c.V.Name;
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.NoContent();
    }

    /// <summary>Nhật ký mở link (mới nhất trước, phân trang): người tạo link, quản lý dự án, HR.</summary>
    private static async Task<Results<Ok<WikiShareViewList>, NotFound, ProblemHttpResult>> ViewsAsync(Guid id, Guid shareId, int? page, int? pageSize,
        ClaimsPrincipal user, ProjectsDbContext db, ProjectAccess access, CancellationToken ct)
    {
        if (await CtxAsync(id, user, db, access, ct) is not { } c) return TypedResults.NotFound();
        var link = await db.WikiShareLinks.AsNoTracking().FirstOrDefaultAsync(x => x.Id == shareId && x.ProjectId == id, ct);
        if (link is null) return TypedResults.NotFound();
        if (!WikiShareRules.CanSeeViews(c.V.CanManage(id), link.CreatedByUserId == c.V.UserId, c.ByToken))
            return Deny(WikiShareRules.ManageDenial(c.V.CanManage(id), c.ByToken) ?? new(403, WikiShareRules.ManagerOnly));
        var size = Math.Clamp(pageSize ?? 20, 1, WikiShareRules.MaxViewPageSize);
        var n = Math.Max(1, page ?? 1);
        var q = db.WikiShareViews.AsNoTracking().Where(x => x.LinkId == shareId);
        var total = await q.CountAsync(ct);
        var items = await q.OrderByDescending(x => x.At).ThenByDescending(x => x.Id).Skip((n - 1) * size).Take(size)
            .Select(x => new WikiShareViewItem(x.At, x.Ip, x.UserAgent)).ToListAsync(ct);
        return TypedResults.Ok(new WikiShareViewList(items, total, n, size));
    }

    // ---- Công khai ----

    /// <param name="Pages">Cây chia sẻ theo thứ tự sổ tay; ParentId = tổ tiên gần nhất có trong bản chia sẻ (null = đứng ở gốc).</param>
    /// <param name="Selected">Trang được chọn (phạm vi pages) — rỗng với phạm vi all.</param>
    private sealed record Resolved(WikiShareLink Link, Project Project, List<WikiShareNode> Pages, List<WikiShareSelection> Selected);

    private static ProblemHttpResult Gone() => TypedResults.Problem(WikiShareRules.GoneMessage, statusCode: StatusCodes.Status410Gone);

    /// <summary>Token → link còn hiệu lực + các trang được chia sẻ. Sai dạng / không có → 404; hết hạn / thu hồi / mọi trang chọn đã xoá / dự án đóng → 410.</summary>
    private static async Task<(Resolved? Ok, IResult? Error)> ResolveAsync(string token, ProjectsDbContext db, ProjectClock clock, bool track, CancellationToken ct)
    {
        if (!UploadLinkRules.LooksLikeToken(token)) return (null, TypedResults.NotFound());
        var hash = UploadLinkRules.Hash(token);
        var q = track ? db.WikiShareLinks : db.WikiShareLinks.AsNoTracking();
        var link = await q.FirstOrDefaultAsync(x => x.TokenHash == hash, ct);
        if (link is null) return (null, TypedResults.NotFound());
        var p = await db.Projects.AsNoTracking().FirstOrDefaultAsync(x => x.Id == link.ProjectId, ct);
        if (p is null) return (null, TypedResults.NotFound());
        var nodes = await NodesAsync(db, p.Id, ct);
        var selected = link.Scope == WikiShareRules.ScopeAll ? []
            : SelectionOf(await db.WikiSharePages.AsNoTracking().Where(x => x.LinkId == link.Id).ToListAsync(ct));
        var shared = WikiShareRules.SharedPages(link.Scope, selected, nodes);
        var state = WikiShareRules.State(link.ExpiresAt, link.RevokedAt, clock.Now, p.Status == ProjectStatus.Active,
            WikiShareRules.HasContent(link.Scope, shared.Count));
        return state == WikiShareState.Active ? (new Resolved(link, p, shared, selected), null) : (null, Gone());
    }

    private static string CookieName(WikiShareLink l) => CookiePrefix + l.Id.ToString("N");

    /// <summary>Đã mở khoá: cookie riêng của link, giải mã được (DataProtection, có hạn) và đúng Id link.</summary>
    private static bool Unlocked(HttpContext http, WikiShareLink l, IDataProtectionProvider dp)
    {
        if (l.PasswordHash is null) return true;
        if (!http.Request.Cookies.TryGetValue(CookieName(l), out var v) || string.IsNullOrEmpty(v)) return false;
        try { return dp.CreateProtector(ProtectorPurpose).ToTimeLimitedDataProtector().Unprotect(v) == l.Id.ToString("N"); }
        catch (System.Security.Cryptography.CryptographicException) { return false; }
    }

    private static string? Ip(HttpContext http) => http.Connection.RemoteIpAddress?.ToString();

    /// <summary>Thông tin link + cây trang. Cần mật khẩu mà chưa mở khoá → không trả cây. Mỗi lần mở (đã xem được nội dung) ghi nhật ký + có thể báo người tạo.</summary>
    private static async Task<IResult> InfoAsync(string token, HttpContext http, ProjectsDbContext db, ProjectClock clock, IDataProtectionProvider dp,
        INotifier notifier, CancellationToken ct)
    {
        var (ok, error) = await ResolveAsync(token, db, clock, true, ct);
        if (ok is null) return error!;
        var l = ok.Link;
        if (!Unlocked(http, l, dp))
            return TypedResults.Ok(new PublicWikiShareDto(ok.Project.Name, null, [], l.ExpiresAt, l.RecipientName, true, true, WikiShareRules.NotSharedHref));
        await RecordViewAsync(ok, http, db, clock, notifier, ct);
        return TypedResults.Ok(new PublicWikiShareDto(ok.Project.Name, ok.Pages.FirstOrDefault()?.Id, ok.Pages.Select(x => new PublicWikiShareNode(x.Id, x.ParentId, x.Title)).ToList(),
            l.ExpiresAt, l.RecipientName, l.PasswordHash is not null, false, WikiShareRules.NotSharedHref));
    }

    /// <summary>Ghi nhật ký mở + báo người tạo (lần đầu / thiết bị mới, ≤ 1 lần / giờ / link).</summary>
    private static async Task RecordViewAsync(Resolved ok, HttpContext http, ProjectsDbContext db, ProjectClock clock, INotifier notifier, CancellationToken ct)
    {
        var l = ok.Link;
        var now = clock.Now;
        var ip = Ip(http);
        var ua = UploadLinkRules.CleanUserAgent(http.Request.Headers.UserAgent);
        var firstView = l.ViewCount == 0;
        var newDevice = !firstView && !await db.WikiShareViews.AnyAsync(x => x.LinkId == l.Id && x.Ip == ip && x.UserAgent == ua, ct);
        db.WikiShareViews.Add(new WikiShareView { LinkId = l.Id, At = now, Ip = ip, UserAgent = ua });
        l.ViewCount++;
        l.LastViewedAt = now;
        var notify = WikiShareRules.ShouldNotify(firstView, newDevice, l.LastNotifiedAt, now);
        if (notify) l.LastNotifiedAt = now;
        await db.SaveChangesAsync(ct);
        if (!notify) return;
        var who = l.RecipientName is { } r ? $" ({r})" : "";
        var what = DescribeScope(ok);
        var title = firstView ? $"Link chia sẻ sổ tay {what} vừa được mở lần đầu" : $"Link chia sẻ sổ tay {what} được mở từ thiết bị mới";
        await notifier.NotifyAsync(new NotificationRequest([l.CreatedByUserId], NotificationCategories.WikiShareViewed, title,
            $"Dự án {ok.Project.Code}{who} · IP {ip ?? "?"} · {ua ?? "trình duyệt không rõ"}", NotifyLink(ok), SendEmail: false), ct);
    }

    /// <summary>Trang được chọn đầu tiên theo thứ tự sổ tay (còn hiện trong bản chia sẻ); phạm vi all → null.</summary>
    private static WikiShareNode? FirstSelected(Resolved ok)
    {
        var ids = ok.Selected.Select(x => x.PageId).ToHashSet();
        return ok.Pages.FirstOrDefault(x => ids.Contains(x.Id));
    }

    /// <summary>Tên phạm vi trong chuông: "toàn bộ sổ tay" / "\"Trang\"" / "\"Trang\" và N trang khác".</summary>
    private static string DescribeScope(Resolved ok)
    {
        if (ok.Link.Scope == WikiShareRules.ScopeAll) return "toàn bộ sổ tay";
        var first = FirstSelected(ok)?.Title ?? "";
        return ok.Selected.Count > 1 ? $"\"{first}\" và {ok.Selected.Count - 1} trang khác" : $"\"{first}\"";
    }

    /// <summary>Link chuông: phạm vi all → tab Sổ tay; phạm vi pages → trang được chọn đầu tiên.</summary>
    private static string NotifyLink(Resolved ok) =>
        ok.Link.Scope != WikiShareRules.ScopeAll && FirstSelected(ok) is { } f
            ? $"/projects/{ok.Project.Id}?tab=wiki&page={f.Id}"
            : $"/projects/{ok.Project.Id}?tab=wiki";

    /// <summary>Mở khoá bằng mật khẩu → cookie riêng của link (HttpOnly, ≤ 24 giờ, không quá hạn link). Sai → 400; sai quá nhiều → 429.</summary>
    private static async Task<IResult> UnlockAsync(string token, WikiShareUnlock r, HttpContext http, ProjectsDbContext db, ProjectClock clock,
        IDataProtectionProvider dp, WikiShareUnlockGuard guard, CancellationToken ct)
    {
        var (ok, error) = await ResolveAsync(token, db, clock, false, ct);
        if (ok is null) return error!;
        var l = ok.Link;
        if (l.PasswordHash is null) return TypedResults.NoContent();
        var ip = Ip(http);
        if (guard.Blocked(l.Id, ip))
            return TypedResults.Problem("Nhập sai mật khẩu quá nhiều lần — thử lại sau 15 phút", statusCode: StatusCodes.Status429TooManyRequests);
        if (string.IsNullOrEmpty(r.Password) || r.Password.Length > WikiShareRules.MaxPassword
            || Hasher.VerifyHashedPassword(l, l.PasswordHash, r.Password) == PasswordVerificationResult.Failed)
        {
            guard.Fail(l.Id, ip);
            return new Validation().Add("password", "Mật khẩu không đúng").Problem();
        }
        var now = clock.Now;
        var until = WikiShareRules.UnlockExpires(now, l.ExpiresAt);
        var value = dp.CreateProtector(ProtectorPurpose).ToTimeLimitedDataProtector().Protect(l.Id.ToString("N"), until);
        http.Response.Cookies.Append(CookieName(l), value, new CookieOptions
        {
            HttpOnly = true, Secure = http.Request.IsHttps, SameSite = SameSiteMode.Lax, Path = CookiePath, Expires = until, IsEssential = true,
        });
        return TypedResults.NoContent();
    }

    /// <summary>Nội dung một trang trong bản chia sẻ (bản mới nhất). Trang ngoài bản chia sẻ → 404; cần mật khẩu mà chưa mở khoá → 401.</summary>
    private static async Task<IResult> PageAsync(string token, Guid pageId, HttpContext http, ProjectsDbContext db, ProjectClock clock,
        IDataProtectionProvider dp, CancellationToken ct)
    {
        var (ok, error) = await ResolveAsync(token, db, clock, false, ct);
        if (ok is null) return error!;
        if (!Unlocked(http, ok.Link, dp)) return TypedResults.Problem("Link cần mật khẩu", statusCode: StatusCodes.Status401Unauthorized);
        var byId = ok.Pages.ToDictionary(x => x.Id);
        if (!byId.TryGetValue(pageId, out var node)) return TypedResults.NotFound();
        var p = await db.WikiPages.AsNoTracking().FirstOrDefaultAsync(x => x.Id == pageId && x.DeletedAt == null, ct);
        if (p is null) return TypedResults.NotFound();
        // Đường dẫn theo cây chia sẻ (tổ tiên gần nhất có trong bản chia sẻ), không lộ trang ngoài phạm vi.
        var path = new List<PublicWikiCrumb>();
        for (var x = node.ParentId; x is { } pid && byId.TryGetValue(pid, out var n) && path.Count < WikiRules.MaxDepth; x = n.ParentId)
            path.Insert(0, new(n.Id, n.Title));
        var content = WikiShareRules.RewriteLinks(p.Content, byId.Keys.ToHashSet(), id => $"/s/{token}?page={id}");
        return TypedResults.Ok(new PublicWikiPageDto(p.Id, node.ParentId, p.Title, p.Summary, content, p.UpdatedAt, path));
    }
}
