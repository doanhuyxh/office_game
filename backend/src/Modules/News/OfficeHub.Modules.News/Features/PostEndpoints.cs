using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Infrastructure;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.News.Features;

/// <summary>
/// Bảng tin: feed, đăng / sửa / xoá bài, cảm xúc. Mọi đường đọc đều qua <see cref="NewsStore.Visible"/> — bài ngoài phạm vi trả 404 (không lộ là có bài).
/// Gọi bằng token AI (MCP) chỉ trả chữ thuần, không trả HTML và không có link tệp.
/// </summary>
public static class PostEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        g.MapGet("/feed", FeedAsync);
        g.MapGet("/posts/{id:guid}", GetAsync);
        g.MapPost("/posts", CreateAsync);
        g.MapPut("/posts/{id:guid}", EditAsync);
        g.MapDelete("/posts/{id:guid}", DeleteAsync);
        g.MapPut("/posts/{id:guid}/reaction", ReactAsync);
        g.MapDelete("/posts/{id:guid}/reaction", UnreactAsync);
        g.MapGet("/posts/{id:guid}/reactions", ReactorsAsync);
        g.MapGet("/unseen-count", UnseenAsync);
        g.MapPost("/seen", SeenAsync);
        g.MapPost("/posts/views", ViewsAsync);
        g.MapGet("/posts/{id:guid}/viewers", ViewersAsync);
    }

    internal static Guid Me(ClaimsPrincipal user) => user.GetUserId() ?? throw new InvalidOperationException("Thiếu tài khoản");

    internal static ProblemHttpResult NoPost() => Problems.NotFound("bài viết");

    // ---------------- Đọc ----------------

    private static async Task<Ok<FeedDto>> FeedAsync(long? cursor, int? take, Guid? authorId, bool? mine, ClaimsPrincipal user, NewsDbContext db,
        NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var now = clock.GetUtcNow();
        var n = Math.Clamp(take ?? 10, 1, 30);

        IQueryable<Post> Q() => store.Visible(v).AsNoTracking().AsSplitQuery().Include(p => p.Targets).Include(p => p.Media)
            .Where(p => (authorId == null || p.AuthorUserId == authorId) && (mine != true || p.AuthorUserId == me));

        List<Post> pinned = [];
        if (cursor is null)
            pinned = await Q().Where(p => p.PinnedUntil > now).OrderByDescending(p => p.PinnedUntil).ThenByDescending(p => p.Seq).ToListAsync(ct);
        var q = Q().Where(p => p.PinnedUntil == null || p.PinnedUntil <= now);
        if (cursor is > 0) q = q.Where(p => p.Seq < cursor);
        var rows = await q.OrderByDescending(p => p.Seq).Take(n + 1).ToListAsync(ct);
        var more = rows.Count > n;
        rows = rows.Take(n).ToList();

        var forAi = user.IsAccessToken();
        var dtos = await store.ToDtosAsync([.. pinned, .. rows], v, forAi, ct);
        return TypedResults.Ok(new FeedDto(dtos.Take(pinned.Count).ToList(), dtos.Skip(pinned.Count).ToList(), more ? rows[^1].Seq : null));
    }

    private static async Task<Results<Ok<PostDto>, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, NewsStore store, CancellationToken ct)
    {
        var v = await store.ViewerAsync(Me(user), user.IsHr(), ct);
        var p = await store.FindVisibleAsync(id, v, ct);
        return p is null ? NoPost() : TypedResults.Ok((await store.ToDtosAsync([p], v, user.IsAccessToken(), ct))[0]);
    }

    // ---------------- Đăng / sửa / xoá ----------------

    private static async Task<Results<Ok<PostDto>, ProblemHttpResult, ValidationProblem>> CreateAsync(PostRequest req, ClaimsPrincipal user, NewsDbContext db,
        NewsStore store, HtmlCleaner cleaner, NewsThrottle throttle, IFileStorage files, IAccountService accounts, IEmployeeDirectory dir,
        IOptions<OfficeSettings> office, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        // Qua trợ lý AI (MCP) chỉ admin / HR được đăng (thông báo chung); nhân viên đăng trên web. Token AI không tải tệp được → không đính kèm.
        var forAi = user.IsAccessToken();
        if (forAi && !user.IsHr())
            return TypedResults.Problem("Chỉ quản trị viên / HR được đăng bài qua trợ lý AI — hãy đăng trên web", statusCode: StatusCodes.Status403Forbidden);
        var html = cleaner.Clean(req.ContentHtml);
        var plain = NewsRules.ToPlainText(html);
        var uploadIds = (req.UploadIds ?? []).Where(u => u != Guid.Empty).Distinct().ToList();
        var targets = (req.Targets ?? []).DistinctBy(t => (t.Kind, t.Id)).ToList();
        if (req.Audience != PostAudience.Departments && req.Audience != PostAudience.Custom) targets = [];

        var val = new Validation();
        var now = clock.GetUtcNow();
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        if (forAi && uploadIds.Count > 0) val.Add("uploadIds", "Đăng qua trợ lý AI không đính kèm tệp được — thêm tệp bằng cách sửa bài trên web");
        if (forAi && (req.PublishAt is not null || req.SharedPostId is not null)) val.Add("publishAt", "Hẹn giờ / chia sẻ bài chỉ làm trên web");
        // Chia sẻ: bài gốc phải xem được, đã đăng, không bị ẩn; chia sẻ bài chia sẻ → trỏ bài gốc của nó
        Guid? sharedId = null;
        if (req.SharedPostId is { } sp && !forAi)
        {
            var src = await store.FindVisibleAsync(sp, v, ct);
            if (src is null || src.PublishAt is not null || src.HiddenAt is not null) return NoPost();
            var rootId = NewsRules.ShareRoot(src.Id, src.SharedPostId);
            if (rootId != src.Id && await store.FindVisibleAsync(rootId, v, ct) is not { PublishAt: null, HiddenAt: null }) return NoPost();
            sharedId = rootId;
        }
        if (req.PublishAt is { } at && !forAi && NewsRules.ValidateSchedule(at, now) is { } badTime) val.Add("publishAt", badTime);
        // Bài chia sẻ được để trống nội dung (bài gốc là phần chính)
        foreach (var (f, m) in NewsRules.ValidatePost(plain, html.Length, uploadIds.Count + (sharedId is null ? 0 : 1), req.Audience, targets.Count))
            if (!(sharedId is not null && f == "uploadIds" && uploadIds.Count <= NewsRules.MaxMedia)) val.Add(f, m);
        if (req.SendEmail && req.Audience == PostAudience.Private) val.Add("sendEmail", "Bài chỉ mình bạn xem thì không gửi email được");
        await ValidateTargetsAsync(req.Audience, targets, val, accounts, dir, ct);
        if (val.Failed) return val.Problem();

        if (req.SendEmail && !user.IsHr())
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById(office.Value.TimeZone);
            var start = NewsRules.StartOfDay(now, tz);
            var sent = await db.Posts.CountAsync(p => p.AuthorUserId == me && p.SendEmail && p.CreatedAt >= start, ct);
            if (sent >= NewsRules.MaxEmailPostsPerDay)
                return TypedResults.Problem($"Mỗi ngày chỉ được đăng {NewsRules.MaxEmailPostsPerDay} bài kèm email — bỏ chọn gửi email hoặc đăng vào ngày mai", statusCode: StatusCodes.Status429TooManyRequests);
        }
        if (!throttle.TryAcquire(me, "post", NewsRules.MinPostInterval))
            return TypedResults.Problem("Đăng chậm lại một chút", statusCode: StatusCodes.Status429TooManyRequests);

        var post = new Post
        {
            AuthorUserId = me, AuthorName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name ?? "?",
            ContentHtml = html, PlainText = plain, Audience = req.Audience, CommentsDisabled = req.CommentsDisabled, SendEmail = req.SendEmail, CreatedAt = now,
            PublishAt = forAi ? null : req.PublishAt, SharedPostId = sharedId,
        };
        foreach (var t in targets) post.Targets.Add(new PostTarget { PostId = post.Id, Kind = t.Kind, TargetId = t.Id });
        var attach = await AttachAsync(post, uploadIds, me, db, files, ct);
        if (attach is not null) return attach;

        db.Posts.Add(post);
        var mentions = NewsRules.ExtractMentions(html).Where(u => u != me).Take(20).ToList();
        await db.SaveChangesAsync(ct);

        // Bài hẹn giờ: email / @nhắc gửi lúc job đăng (NewsScheduler)
        if (post.PublishAt is null) await NotifyNewPostAsync(post, mentions, store, ct);
        return TypedResults.Ok((await store.ToDtosAsync([post], v, forAi, ct))[0]);
    }

    private static async Task<Results<Ok<PostDto>, ProblemHttpResult, ValidationProblem>> EditAsync(Guid id, EditPostRequest req, ClaimsPrincipal user,
        NewsDbContext db, NewsStore store, HtmlCleaner cleaner, IFileStorage files, IAccountService accounts, IEmployeeDirectory dir, TimeProvider clock,
        ILogger<NewsStore> log, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var post = await store.FindVisibleAsync(id, v, ct, track: true);
        if (post is null || post.AuthorUserId != me) return NoPost();
        if (post.HiddenAt is not null) return Problems.Conflict("Bài đã bị ẩn bởi quản trị, không sửa được");

        var html = cleaner.Clean(req.ContentHtml);
        var plain = NewsRules.ToPlainText(html);
        var remove = (req.RemoveMediaIds ?? []).ToHashSet();
        var uploadIds = (req.UploadIds ?? []).Where(u => u != Guid.Empty).Distinct().ToList();
        var targets = (req.Targets ?? []).DistinctBy(t => (t.Kind, t.Id)).ToList();
        if (req.Audience != PostAudience.Departments && req.Audience != PostAudience.Custom) targets = [];

        var remaining = post.Media.Count(m => !remove.Contains(m.Id));
        var scheduled = post.PublishAt is not null;
        var now = clock.GetUtcNow();
        var val = new Validation();
        foreach (var (f, m) in NewsRules.ValidatePost(plain, html.Length, remaining + uploadIds.Count + (post.SharedPostId is null ? 0 : 1), req.Audience, targets.Count))
            if (!(post.SharedPostId is not null && f == "uploadIds" && remaining + uploadIds.Count <= NewsRules.MaxMedia)) val.Add(f, m);
        if (scheduled && !req.PublishNow && req.PublishAt is { } at && NewsRules.ValidateSchedule(at, now) is { } badTime) val.Add("publishAt", badTime);
        await ValidateTargetsAsync(req.Audience, targets, val, accounts, dir, ct);
        if (val.Failed) return val.Problem();

        var oldMentions = NewsRules.ExtractMentions(post.ContentHtml).ToHashSet();
        post.ContentHtml = html;
        post.PlainText = plain;
        post.Audience = req.Audience;
        post.CommentsDisabled = req.CommentsDisabled;
        if (req.Audience != PostAudience.Company) post.PinnedUntil = null;
        if (scheduled) { if (!req.PublishNow && req.PublishAt is { } newAt) post.PublishAt = newAt; } // chưa đăng → không tính "đã sửa"
        else post.EditedAt = now;

        db.Targets.RemoveRange(post.Targets);
        post.Targets = targets.Select(t => new PostTarget { PostId = post.Id, Kind = t.Kind, TargetId = t.Id }).ToList();
        var removed = post.Media.Where(m => remove.Contains(m.Id)).ToList();
        foreach (var m in removed) { post.Media.Remove(m); db.Media.Remove(m); }
        var attach = await AttachAsync(post, uploadIds, me, db, files, ct, startOrder: post.Media.Count == 0 ? 0 : post.Media.Max(m => m.Order) + 1);
        if (attach is not null) return attach;
        await db.SaveChangesAsync(ct);
        // Tệp gỡ khỏi bài không còn ai tham chiếu → xoá trên S3 (lỗi chỉ ghi log, bài đã lưu)
        foreach (var m in removed)
            try { await files.DeleteAsync(m.FileKey, ct); }
            catch (Exception ex) { log.LogWarning(ex, "Không xoá được tệp {Key} đã gỡ khỏi bài", m.FileKey); }

        if (scheduled)
        {
            if (req.PublishNow) await NewsScheduler.PublishAsync(db, store, post.Id, now, ct);
        }
        else
        {
            var fresh = NewsRules.ExtractMentions(html).Where(u => u != me && !oldMentions.Contains(u)).Take(20).ToList();
            await NotifyMentionsAsync(post, fresh, [], store, ct);
        }
        var saved = await store.FindVisibleAsync(post.Id, v, ct);
        return TypedResults.Ok((await store.ToDtosAsync([saved!], v, false, ct))[0]);
    }

    private static async Task<Results<NoContent, ProblemHttpResult>> DeleteAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var post = await store.FindVisibleAsync(id, v, ct, track: true);
        if (post is null || (post.AuthorUserId != me && !v.IsHr)) return NoPost();
        post.DeletedAt = clock.GetUtcNow();
        post.PinnedUntil = null;
        await db.SaveChangesAsync(ct);
        if (post.AuthorUserId != me)
            await store.NotifyAsync([post.AuthorUserId], NotificationCategories.NewsModerated, "Bài viết của bạn đã bị gỡ",
                $"Quản trị đã gỡ bài \"{NewsRules.Preview(post.PlainText, 80)}\".", "/news", false, ct);
        return TypedResults.NoContent();
    }

    // ---------------- Cảm xúc ----------------

    private static async Task<Results<Ok<ReactionSummary>, ProblemHttpResult>> ReactAsync(Guid id, ReactionRequest req, ClaimsPrincipal user, NewsDbContext db,
        NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        if (!Enum.IsDefined(req.Type)) return Problems.NotFound("cảm xúc");
        if (await store.FindVisibleAsync(id, v, ct) is null) return NoPost();
        await CommentEndpoints.SetReactionAsync(db, store, TargetType.Post, id, me, req.Type, clock.GetUtcNow(), ct);
        return TypedResults.Ok(await CommentEndpoints.SummaryAsync(db, TargetType.Post, id, me, ct));
    }

    private static async Task<Results<Ok<ReactionSummary>, ProblemHttpResult>> UnreactAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store, CancellationToken ct)
    {
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        if (await store.FindVisibleAsync(id, v, ct) is null) return NoPost();
        await db.Reactions.Where(r => r.TargetType == TargetType.Post && r.TargetId == id && r.UserId == me).ExecuteDeleteAsync(ct);
        await store.RecountReactionsAsync(TargetType.Post, id, ct);
        return TypedResults.Ok(await CommentEndpoints.SummaryAsync(db, TargetType.Post, id, me, ct));
    }

    private static async Task<Results<Ok<List<ReactorDto>>, ProblemHttpResult>> ReactorsAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        IAccountService accounts, CancellationToken ct)
    {
        var v = await store.ViewerAsync(Me(user), user.IsHr(), ct);
        if (await store.FindVisibleAsync(id, v, ct) is null) return NoPost();
        return TypedResults.Ok(await CommentEndpoints.ReactorsOfAsync(db, accounts, TargetType.Post, id, ct));
    }

    // ---------------- Đã xem ----------------

    /// <summary>
    /// FE báo các bài đã hiện trên màn hình (≥ 1 giây). Ghi lần xem đầu tiên của bài xem được, đã đăng, không phải của mình; bài không xem được
    /// bị bỏ qua (không lộ là có bài). Token AI không gọi được (không có trong danh sách route token).
    /// </summary>
    private static async Task<Results<NoContent, ValidationProblem>> ViewsAsync(ViewsRequest req, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        TimeProvider clock, CancellationToken ct)
    {
        var ids = (req.PostIds ?? []).Where(i => i != Guid.Empty).Distinct().ToList();
        if (ids.Count > NewsRules.MaxViewBatch) return new Validation().Add("postIds", $"Tối đa {NewsRules.MaxViewBatch} bài / lần").Problem();
        if (ids.Count == 0) return TypedResults.NoContent();
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var ok = await store.Visible(v).Where(p => ids.Contains(p.Id) && p.AuthorUserId != me && p.PublishAt == null).Select(p => p.Id).ToArrayAsync(ct);
        if (ok.Length == 0) return TypedResults.NoContent();
        var now = clock.GetUtcNow();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO news.post_views ("PostId", "UserId", "ViewedAt") SELECT unnest({ok}), {me}, {now} ON CONFLICT DO NOTHING""", ct);
        return TypedResults.NoContent();
    }

    /// <summary>
    /// Ai đã xem bài: chỉ tác giả + HR (chủ dự án chốt 2026-11-12); người khác (kể cả xem được bài) → 404. Chỉ trên web: token AI được GET
    /// <c>/api/news/posts/*</c> nhưng danh sách người đọc không đi ra trợ lý AI → 403.
    /// </summary>
    private static async Task<Results<Ok<ViewersDto>, ProblemHttpResult>> ViewersAsync(Guid id, ClaimsPrincipal user, NewsDbContext db, NewsStore store,
        IEmployeeDirectory dir, IAccountService accounts, CancellationToken ct)
    {
        if (user.IsAccessToken())
            return TypedResults.Problem("Danh sách người đã xem chỉ xem trên web", statusCode: StatusCodes.Status403Forbidden);
        var me = Me(user);
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var post = await store.FindVisibleAsync(id, v, ct);
        if (post is null || (post.AuthorUserId != me && !v.IsHr)) return NoPost();
        var rows = await db.Views.AsNoTracking().Where(x => x.PostId == id).OrderByDescending(x => x.ViewedAt).ToListAsync(ct);
        var emps = (await dir.ListActiveAsync(ct)).Where(e => e.UserId is not null).ToDictionary(e => e.UserId!.Value);
        var shown = rows.Take(NewsRules.MaxViewerList).ToList();
        var accs = await accounts.GetManyAsync(shown.Where(r => !emps.ContainsKey(r.UserId)).Select(r => r.UserId).ToList(), ct);
        var items = shown.Select(r => emps.TryGetValue(r.UserId, out var e)
                ? new ViewerDto(r.UserId, e.FullName, e.Code, e.DepartmentName, r.ViewedAt)
                : new ViewerDto(r.UserId, accs.TryGetValue(r.UserId, out var a) ? (string.IsNullOrWhiteSpace(a.FullName) ? a.UserName : a.FullName) : "Người dùng", null, null, r.ViewedAt))
            .ToList();
        var audience = post.Audience == PostAudience.Private ? 0 : (await store.AudienceUsersAsync(post, ct)).Count;
        return TypedResults.Ok(new ViewersDto(rows.Count, audience, items));
    }

    // ---------------- Badge "bài mới" ----------------

    private static async Task<Ok<CountDto>> UnseenAsync(ClaimsPrincipal user, NewsDbContext db, NewsStore store, TimeProvider clock, CancellationToken ct)
    {
        var me = Me(user);
        var state = await db.FeedStates.AsNoTracking().FirstOrDefaultAsync(s => s.UserId == me, ct);
        if (state is null) // lần đầu: coi như đã xem hết bài hiện có (không báo "hàng trăm bài mới")
        {
            await MarkSeenAsync(db, me, clock, ct);
            return TypedResults.Ok(new CountDto(0));
        }
        var v = await store.ViewerAsync(me, user.IsHr(), ct);
        var n = await store.Visible(v).CountAsync(p => p.Seq > state.LastSeenSeq && p.AuthorUserId != me && p.HiddenAt == null, ct);
        return TypedResults.Ok(new CountDto(n));
    }

    private static async Task<NoContent> SeenAsync(ClaimsPrincipal user, NewsDbContext db, TimeProvider clock, CancellationToken ct)
    {
        await MarkSeenAsync(db, Me(user), clock, ct);
        return TypedResults.NoContent();
    }

    private static async Task MarkSeenAsync(NewsDbContext db, Guid me, TimeProvider clock, CancellationToken ct)
    {
        var max = await db.Posts.MaxAsync(p => (long?)p.Seq, ct) ?? 0;
        var now = clock.GetUtcNow();
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var s = await db.FeedStates.FirstOrDefaultAsync(x => x.UserId == me, ct);
            if (s is null) db.FeedStates.Add(new FeedState { UserId = me, LastSeenSeq = max, UpdatedAt = now });
            else if (s.LastSeenSeq < max) { s.LastSeenSeq = max; s.UpdatedAt = now; }
            else return;
            try { await db.SaveChangesAsync(ct); return; }
            catch (DbUpdateException) when (attempt == 0) { db.ChangeTracker.Clear(); }
        }
    }

    // ---------------- Dùng chung ----------------

    private static async Task ValidateTargetsAsync(PostAudience audience, List<TargetRequest> targets, Validation val, IAccountService accounts,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        if (audience == PostAudience.Departments)
        {
            var known = (await dir.ListDepartmentsAsync(ct)).Select(d => d.Id).ToHashSet();
            if (targets.Any(t => t.Kind != TargetKind.Department || !known.Contains(t.Id))) val.Add("targets", "Có phòng ban không tồn tại");
        }
        else if (audience == PostAudience.Custom)
        {
            if (targets.Any(t => t.Kind != TargetKind.User)) { val.Add("targets", "Danh sách người xem không hợp lệ"); return; }
            var found = await accounts.GetManyAsync(targets.Select(t => t.Id).ToList(), ct);
            if (targets.Any(t => !found.TryGetValue(t.Id, out var a) || !a.IsActive)) val.Add("targets", "Có người xem không tồn tại hoặc đã bị khoá");
        }
    }

    /// <summary>Gắn tệp từ vé tải lên vào bài: kiểm tra chủ vé, đã lên S3 đủ dung lượng; trả lỗi (hoặc null nếu ổn).</summary>
    private static async Task<Results<Ok<PostDto>, ProblemHttpResult, ValidationProblem>?> AttachAsync(Post post, List<Guid> uploadIds, Guid me, NewsDbContext db,
        IFileStorage files, CancellationToken ct, int startOrder = 0)
    {
        if (uploadIds.Count == 0) return null;
        var tickets = await db.UploadTickets.Where(t => uploadIds.Contains(t.Id) && t.UserId == me).ToListAsync(ct);
        if (tickets.Count != uploadIds.Count)
            return new Validation().Add("uploadIds", "Tệp đính kèm không hợp lệ hoặc đã hết hạn — tải lại tệp").Problem();
        var order = startOrder;
        foreach (var id in uploadIds)
        {
            var t = tickets.First(x => x.Id == id);
            // TEST-13: chép key tạm → key chính + kiểm chữ ký đầu file trên bản đã chép
            var check = await files.PromoteUploadAsync(t.FileKey, t.FileName, ct);
            if (check.Error is { } bad) return new Validation().Add("uploadIds", $"Tệp \"{t.FileName}\": {bad}").Problem();
            var size = check.Size;
            if (size is null) return Problems.Conflict($"Tệp \"{t.FileName}\" chưa tải lên xong — thử lại");
            if (size.Value <= 0 || size.Value > NewsRules.MaxSizeOf(t.Kind))
            {
                await files.DeleteAsync(t.FileKey, ct);
                return new Validation().Add("uploadIds", $"Tệp \"{t.FileName}\" vượt giới hạn dung lượng").Problem();
            }
            post.Media.Add(new PostMedia { PostId = post.Id, Order = order++, Kind = t.Kind, FileKey = t.FileKey, FileName = t.FileName, ContentType = t.ContentType, Size = size.Value });
        }
        db.UploadTickets.RemoveRange(tickets);
        return null;
    }

    internal static async Task NotifyNewPostAsync(Post post, List<Guid> mentionIds, NewsStore store, CancellationToken ct)
    {
        var emailTo = new HashSet<Guid>();
        if (post.SendEmail && post.Audience != PostAudience.Private)
        {
            foreach (var u in await store.AudienceUsersAsync(post, ct)) emailTo.Add(u);
            await store.NotifyAsync(emailTo, NotificationCategories.NewsPublished, $"{post.AuthorName} vừa đăng bài trên Bảng tin",
                NewsRules.Preview(post.PlainText), $"/news/{post.Id}", true, ct);
        }
        await NotifyMentionsAsync(post, mentionIds, emailTo, store, ct);
    }

    internal static async Task NotifyMentionsAsync(Post post, List<Guid> mentionIds, IReadOnlyCollection<Guid> alreadyNotified, NewsStore store, CancellationToken ct)
    {
        if (mentionIds.Count == 0) return;
        var visible = (await store.FilterVisibleAsync(post, mentionIds, ct)).Where(u => !alreadyNotified.Contains(u) && u != post.AuthorUserId).ToList();
        await store.NotifyAsync(visible, NotificationCategories.NewsMention, $"{post.AuthorName} đã nhắc đến bạn trong một bài viết",
            NewsRules.Preview(post.PlainText, 120), $"/news/{post.Id}", false, ct);
    }
}

/// <summary>Số cảm xúc theo loại + cảm xúc của tôi sau khi thả / gỡ.</summary>
public sealed record ReactionSummary(int Total, IReadOnlyDictionary<ReactionType, int> Counts, ReactionType? Mine);
