using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.News.Domain;
using OfficeHub.Modules.News.Features;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.News.Infrastructure;

/// <summary>Giới hạn tốc độ đăng bài / bình luận theo tài khoản (bộ nhớ, một instance Api).</summary>
public sealed class NewsThrottle(TimeProvider clock)
{
    private readonly ConcurrentDictionary<(Guid, string), DateTimeOffset> _last = new();

    public bool TryAcquire(Guid userId, string kind, TimeSpan interval)
    {
        var now = clock.GetUtcNow();
        var ok = false;
        _last.AddOrUpdate((userId, kind), _ => { ok = true; return now; }, (_, last) =>
        {
            ok = now - last >= interval;
            return ok ? now : last;
        });
        return ok;
    }
}

/// <summary>Người xem: phòng ban (kèm phòng cha) để so với phạm vi bài; IsHr được thấy bài bị ẩn và ẩn / ghim bài.</summary>
public sealed record Viewer(Guid UserId, bool IsHr, IReadOnlySet<Guid> Departments);

/// <summary>Dùng chung cho các endpoint: phạm vi người xem, truy vấn bài xem được, quy đổi DTO, người nhận thông báo.</summary>
public sealed class NewsStore(NewsDbContext db, IEmployeeDirectory directory, IAccountService accounts, IFileStorage files, INotifier notifier, TimeProvider clock)
{
    public async Task<Viewer> ViewerAsync(Guid userId, bool isHr, CancellationToken ct)
    {
        var emp = await directory.GetByUserIdAsync(userId, ct);
        var chain = emp?.DepartmentId is null ? new HashSet<Guid>() : NewsRules.DepartmentChain(emp.DepartmentId, await ParentMapAsync(ct));
        return new Viewer(userId, isHr, chain);
    }

    private async Task<Dictionary<Guid, Guid?>> ParentMapAsync(CancellationToken ct) =>
        (await directory.ListDepartmentsAsync(ct)).ToDictionary(d => d.Id, d => d.ParentId);

    /// <summary>Bài người xem thấy được (chưa xoá; bài ẩn chỉ tác giả + HR thấy; bài hẹn giờ chưa đăng chỉ tác giả thấy).</summary>
    public IQueryable<Post> Visible(Viewer v)
    {
        var me = v.UserId;
        var depts = v.Departments.ToList();
        var hr = v.IsHr;
        return db.Posts.Where(p => p.DeletedAt == null
            && (p.HiddenAt == null || p.AuthorUserId == me || hr)
            && (p.PublishAt == null || p.AuthorUserId == me)
            && (p.AuthorUserId == me || p.Audience == PostAudience.Company
                || (p.Audience == PostAudience.Departments && p.Targets.Any(t => t.Kind == TargetKind.Department && depts.Contains(t.TargetId)))
                || (p.Audience == PostAudience.Custom && p.Targets.Any(t => t.Kind == TargetKind.User && t.TargetId == me))));
    }

    /// <summary>Kiểm tra một bài cụ thể (đọc / bình luận / tệp): null = không thấy (→ 404).</summary>
    public Task<Post?> FindVisibleAsync(Guid postId, Viewer v, CancellationToken ct, bool track = false)
    {
        var q = Visible(v).Include(p => p.Targets).Include(p => p.Media).Where(p => p.Id == postId);
        return (track ? q : q.AsNoTracking()).FirstOrDefaultAsync(ct);
    }

    /// <summary>Lọc <paramref name="userIds"/> còn những người xem được bài (người được @nhắc, người nhận thông báo). Bài ẩn / xoá → rỗng.</summary>
    public async Task<List<Guid>> FilterVisibleAsync(Post p, IEnumerable<Guid> userIds, CancellationToken ct)
    {
        var ids = userIds.Distinct().ToList();
        if (p.DeletedAt is not null || p.HiddenAt is not null || ids.Count == 0) return [];
        var parents = await ParentMapAsync(ct);
        var emps = (await directory.ListActiveAsync(ct)).Where(e => e.UserId.HasValue).ToDictionary(e => e.UserId!.Value);
        var targets = p.Targets.Select(t => (t.Kind, t.TargetId)).ToList();
        return ids.Where(u => NewsRules.CanView(p.Audience, p.AuthorUserId, u, NewsRules.DepartmentChain(emps.GetValueOrDefault(u)?.DepartmentId, parents), targets)).ToList();
    }

    // ---------------- Người nhận theo phạm vi ----------------

    /// <summary>Tài khoản trong phạm vi bài (trừ tác giả): Company = mọi nhân viên đang làm + admin / HR; Departments = nhân viên thuộc phòng đích hoặc phòng con; Custom = danh sách đã chọn (còn hoạt động).</summary>
    public async Task<IReadOnlyCollection<Guid>> AudienceUsersAsync(Post p, CancellationToken ct)
    {
        var ids = new HashSet<Guid>();
        switch (p.Audience)
        {
            case PostAudience.Company:
                foreach (var e in await directory.ListActiveAsync(ct)) if (e.UserId is { } u) ids.Add(u);
                foreach (var role in new[] { Roles.Admin, Roles.Hr })
                    foreach (var a in await accounts.ListByRoleAsync(role, ct)) ids.Add(a.Id);
                break;
            case PostAudience.Departments:
                var parents = await ParentMapAsync(ct);
                var targets = p.Targets.Where(t => t.Kind == TargetKind.Department).Select(t => t.TargetId).ToHashSet();
                foreach (var e in await directory.ListActiveAsync(ct))
                    if (e.UserId is { } u && NewsRules.DepartmentChain(e.DepartmentId, parents).Overlaps(targets)) ids.Add(u);
                break;
            case PostAudience.Custom:
                var wanted = p.Targets.Where(t => t.Kind == TargetKind.User).Select(t => t.TargetId).ToList();
                foreach (var (id, a) in await accounts.GetManyAsync(wanted, ct)) if (a.IsActive) ids.Add(id);
                break;
        }
        ids.Remove(p.AuthorUserId);
        return ids;
    }

    /// <summary>Gửi thông báo, không bao giờ ném lỗi (đã lưu dữ liệu xong).</summary>
    public async Task NotifyAsync(IReadOnlyCollection<Guid> to, string category, string title, string body, string link, bool email, CancellationToken ct)
    {
        if (to.Count == 0) return;
        try { await notifier.NotifyAsync(new NotificationRequest(to, category, title, body, link, email), ct); }
        catch { /* thông báo là phụ — bài / bình luận đã lưu */ }
    }

    // ---------------- DTO ----------------

    public async Task<IReadOnlyList<PostDto>> ToDtosAsync(IReadOnlyList<Post> posts, Viewer v, bool forAi, CancellationToken ct, bool withShared = true)
    {
        if (posts.Count == 0) return [];
        // Bài gốc của các bài chia sẻ — chỉ những bài người xem tự xem được (chia sẻ không mở rộng phạm vi)
        var sharedIds = withShared ? posts.Where(p => p.SharedPostId is not null).Select(p => p.SharedPostId!.Value).Distinct().ToList() : [];
        var shared = new Dictionary<Guid, PostDto>();
        if (sharedIds.Count > 0)
        {
            var originals = await Visible(v).AsNoTracking().AsSplitQuery().Include(p => p.Targets).Include(p => p.Media)
                .Where(p => sharedIds.Contains(p.Id) && p.PublishAt == null).ToListAsync(ct);
            foreach (var d in await ToDtosAsync(originals, v, forAi, ct, withShared: false)) shared[d.Id] = d;
        }
        // "Đã xem": chỉ tác giả + HR
        var statIds = posts.Where(p => p.AuthorUserId == v.UserId || v.IsHr).Select(p => p.Id).ToList();
        var views = statIds.Count == 0 ? [] : await db.Views.AsNoTracking().Where(x => statIds.Contains(x.PostId))
            .GroupBy(x => x.PostId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N, ct);
        var ids = posts.Select(p => p.Id).ToList();
        var reacts = await db.Reactions.AsNoTracking().Where(r => r.TargetType == TargetType.Post && ids.Contains(r.TargetId))
            .GroupBy(r => new { r.TargetId, r.Type }).Select(g => new { g.Key.TargetId, g.Key.Type, N = g.Count() }).ToListAsync(ct);
        var mine = await db.Reactions.AsNoTracking().Where(r => r.TargetType == TargetType.Post && ids.Contains(r.TargetId) && r.UserId == v.UserId)
            .ToDictionaryAsync(r => r.TargetId, r => r.Type, ct);
        var authors = await AuthorsAsync(posts.Select(p => (p.AuthorUserId, p.AuthorName)), ct);
        var names = await TargetNamesAsync(posts.SelectMany(p => p.Targets), ct);
        var now = clock.GetUtcNow();

        var list = new List<PostDto>();
        foreach (var p in posts)
        {
            var media = new List<MediaDto>();
            foreach (var m in p.Media.OrderBy(m => m.Order))
                media.Add(new MediaDto(m.Id, m.Kind, m.FileName, m.ContentType, m.Size, forAi ? null
                    : await files.GetDownloadUrlAsync(m.FileKey, m.FileName, inline: m.Kind != MediaKind.File, NewsRules.MediaUrlTtl)));
            var own = p.AuthorUserId == v.UserId;
            list.Add(new PostDto(p.Id, p.Seq, authors[p.AuthorUserId], forAi ? null : p.ContentHtml, p.PlainText, p.Audience,
                p.Targets.Select(t => new AudienceTargetDto(t.Kind, t.TargetId, names.GetValueOrDefault((t.Kind, t.TargetId), "?"))).ToList(),
                p.CommentsDisabled, p.PinnedUntil > now, p.CreatedAt, p.EditedAt, p.HiddenAt is not null, own || v.IsHr ? p.HiddenReason : null, media,
                p.ReactionCount, reacts.Where(r => r.TargetId == p.Id).ToDictionary(r => r.Type, r => r.N), mine.TryGetValue(p.Id, out var mt) ? mt : null,
                p.CommentCount, p.SendEmail, own, own || v.IsHr, v.IsHr,
                p.PublishAt, own || v.IsHr ? views.GetValueOrDefault(p.Id) : null,
                p.SharedPostId, p.SharedPostId is { } sid ? shared.GetValueOrDefault(sid) : null));
        }
        return list;
    }

    public async Task<IReadOnlyList<CommentDto>> ToCommentDtosAsync(IReadOnlyList<Comment> comments, Viewer v, bool forAi, CancellationToken ct)
    {
        if (comments.Count == 0) return [];
        var ids = comments.Select(c => c.Id).ToList();
        var mine = await db.Reactions.AsNoTracking().Where(r => r.TargetType == TargetType.Comment && ids.Contains(r.TargetId) && r.UserId == v.UserId)
            .ToDictionaryAsync(r => r.TargetId, r => r.Type, ct);
        var authors = await AuthorsAsync(comments.Select(c => (c.AuthorUserId, c.AuthorName)), ct);
        var list = new List<CommentDto>();
        foreach (var c in comments)
        {
            var own = c.AuthorUserId == v.UserId;
            var deleted = c.DeletedAt is not null;
            var hiddenFromMe = c.HiddenAt is not null && !own && !v.IsHr;
            var gone = deleted || hiddenFromMe;
            string? img = gone || forAi || c.ImageKey is null ? null
                : await files.GetDownloadUrlAsync(c.ImageKey, c.ImageName ?? "image", inline: true, NewsRules.MediaUrlTtl);
            list.Add(new CommentDto(c.Id, c.Seq, c.PostId, c.ParentId, authors[c.AuthorUserId], gone || c.Text.Length == 0 ? null : c.Text, img, c.CreatedAt, c.EditedAt,
                c.HiddenAt is not null, own || v.IsHr ? c.HiddenReason : null, deleted, c.ReactionCount, mine.TryGetValue(c.Id, out var mt) ? mt : null,
                own && !deleted, !deleted && (own || v.IsHr), !deleted && v.IsHr));
        }
        return list;
    }

    private async Task<Dictionary<Guid, AuthorDto>> AuthorsAsync(IEnumerable<(Guid UserId, string Name)> authors, CancellationToken ct)
    {
        var distinct = authors.GroupBy(a => a.UserId).ToDictionary(g => g.Key, g => g.First().Name);
        var emps = (await directory.ListActiveAsync(ct)).Where(e => e.UserId is { } u && distinct.ContainsKey(u)).ToDictionary(e => e.UserId!.Value);
        var result = new Dictionary<Guid, AuthorDto>();
        foreach (var (id, name) in distinct)
        {
            var e = emps.GetValueOrDefault(id);
            result[id] = new AuthorDto(id, e?.Id, e?.FullName is { Length: > 0 } n ? n : name, e?.DepartmentName);
        }
        return result;
    }

    private async Task<Dictionary<(TargetKind, Guid), string>> TargetNamesAsync(IEnumerable<PostTarget> targets, CancellationToken ct)
    {
        var list = targets.DistinctBy(t => (t.Kind, t.TargetId)).ToList();
        var map = new Dictionary<(TargetKind, Guid), string>();
        if (list.Count == 0) return map;
        if (list.Any(t => t.Kind == TargetKind.Department))
            foreach (var d in await directory.ListDepartmentsAsync(ct)) map[(TargetKind.Department, d.Id)] = d.Name;
        var userIds = list.Where(t => t.Kind == TargetKind.User).Select(t => t.TargetId).ToList();
        if (userIds.Count > 0)
            foreach (var (id, a) in await accounts.GetManyAsync(userIds, ct)) map[(TargetKind.User, id)] = string.IsNullOrWhiteSpace(a.FullName) ? a.UserName : a.FullName;
        return map;
    }

    /// <summary>Đặt lại số cảm xúc / bình luận từ dữ liệu gốc (tránh lệch do đua).</summary>
    public async Task RecountReactionsAsync(TargetType type, Guid id, CancellationToken ct)
    {
        var n = await db.Reactions.CountAsync(r => r.TargetType == type && r.TargetId == id, ct);
        if (type == TargetType.Post) await db.Posts.Where(p => p.Id == id).ExecuteUpdateAsync(s => s.SetProperty(p => p.ReactionCount, n), ct);
        else await db.Comments.Where(c => c.Id == id).ExecuteUpdateAsync(s => s.SetProperty(c => c.ReactionCount, n), ct);
    }

    public async Task RecountCommentsAsync(Guid postId, CancellationToken ct)
    {
        var n = await db.Comments.CountAsync(c => c.PostId == postId && c.DeletedAt == null, ct);
        await db.Posts.Where(p => p.Id == postId).ExecuteUpdateAsync(s => s.SetProperty(p => p.CommentCount, n), ct);
    }
}
