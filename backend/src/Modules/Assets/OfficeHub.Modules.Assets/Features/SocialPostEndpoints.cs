using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Assets.Domain;
using OfficeHub.Modules.Assets.Infrastructure;

namespace OfficeHub.Modules.Assets.Features;

/// <summary>
/// Đăng bài lên Fanpage: HR đăng lên mọi trang; nhân viên chỉ lên trang thuộc BM đang được giao cho mình. Ảnh / video tải thẳng lên S3
/// (<c>assets/social/</c>), Facebook tự tải về qua link có hạn. Đăng ngay hoặc hẹn giờ — job nền gửi đi (<see cref="SocialPublishJob"/>).
/// Không mở cho token AI (route không có trong danh sách cho phép của <c>AccessTokenAuth</c>).
/// </summary>
internal static class SocialPostEndpoints
{
    public static void Map(RouteGroupBuilder g)
    {
        var s = g.MapGroup(SocialRules.FacebookApiPrefix).RequireAuthorization();
        s.MapGet("/pages", PagesAsync);
        s.MapPost("/media", CreateMediaAsync);
        s.MapPost("/media/{id:guid}/confirm", ConfirmMediaAsync);
        s.MapGet("/media/{id:guid}/url", MediaUrlAsync);
        s.MapGet("/posts", ListAsync);
        s.MapGet("/posts/{id:guid}", GetAsync);
        s.MapPost("/posts", CreateAsync);
        s.MapPut("/posts/{id:guid}", UpdateAsync);
        s.MapPost("/posts/{id:guid}/cancel", CancelAsync);
        s.MapPost("/targets/{id:guid}/retry", RetryAsync);
    }

    private static ProblemHttpResult Forbidden(string msg) => TypedResults.Problem(msg, statusCode: StatusCodes.Status403Forbidden);

    private static ProblemHttpResult NoAccount(Viewer me) =>
        Forbidden(me.IsHr ? "Chưa có Business Manager nào đang dùng" : "Bạn chưa được giao Business Manager nào");

    /// <summary>Id các BM người xem được đăng (HR: mọi BM đang dùng; nhân viên: BM đang giữ).</summary>
    private static async Task<List<Guid>> PostableAccountIdsAsync(Viewer me, AssetsDbContext db, CancellationToken ct)
    {
        var q = db.SocialAccounts.AsNoTracking().Where(a => a.Status == SocialAccountStatus.Active);
        if (!me.IsHr)
        {
            if (me.Employee is null) return [];
            var emp = me.Employee.Id;
            q = q.Where(a => a.HolderEmployeeId == emp);
        }
        return await q.Select(a => a.Id).ToListAsync(ct);
    }

    /// <summary>Trang thuộc BM người xem đang giữ (không tính quyền HR) — để xem / quản lý bài người khác đăng lên trang của mình.</summary>
    private static async Task<HashSet<Guid>> HeldPageIdsAsync(Viewer me, AssetsDbContext db, CancellationToken ct)
    {
        if (me.Employee is null) return [];
        var emp = me.Employee.Id;
        return (await (from p in db.SocialPages.AsNoTracking()
                       join a in db.SocialAccounts.AsNoTracking() on p.AccountId equals a.Id
                       where a.HolderEmployeeId == emp && a.Status == SocialAccountStatus.Active
                       select p.Id).ToListAsync(ct)).ToHashSet();
    }

    private static async Task<Results<Ok<List<SocialPageDto>>, ProblemHttpResult>> PagesAsync(ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var ids = await PostableAccountIdsAsync(me, db, ct);
        var rows = await (from p in db.SocialPages.AsNoTracking()
                          join a in db.SocialAccounts.AsNoTracking() on p.AccountId equals a.Id
                          where ids.Contains(a.Id) && p.IsActive
                          orderby a.Name, p.Name
                          select new { p, a.Name }).ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => SocialAccountEndpoints.ToDto(r.p, r.Name)).ToList());
    }

    // ---------------- Ảnh / video ----------------

    private static async Task<Results<Ok<SocialMediaUploadDto>, ValidationProblem, ProblemHttpResult>> CreateMediaAsync(SocialMediaUploadRequest r,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, IFileStorage files, AssetClock clock, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        if ((await PostableAccountIdsAsync(me, db, ct)).Count == 0) return NoAccount(me);
        var name = AssetRules.CleanFileName(r.FileName);
        var (kind, contentType, err) = SocialRules.ClassifyMedia(name, r.Size);
        if (name.Length == 0) err = "Thiếu tên tệp";
        if (err is not null) return new Validation().Add(err.Contains("tối đa") || err == "Tệp rỗng" ? "size" : "fileName", err).Problem();
        var now = clock.Now;
        // Dọn link bỏ dở (> 1 ngày chưa xác nhận) — chỉ xoá dòng
        await db.SocialMedia.Where(m => !m.Ready && m.CreatedAt < now.AddDays(-1)).ExecuteDeleteAsync(ct);
        var m = new SocialMedia { Kind = kind, FileName = name, ContentType = contentType, Size = r.Size, CreatedAt = now, CreatedByUserId = me.UserId, FileKey = "" };
        m.FileKey = SocialRules.MediaKey(now, m.Id, name);
        db.SocialMedia.Add(m);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new SocialMediaUploadDto(m.Id, await files.GetUploadUrlAsync(m.FileKey, contentType, SocialRules.UploadUrlTtl), contentType, kind,
            now + SocialRules.UploadUrlTtl));
    }

    private static SocialMediaDto ToDto(SocialMedia m) => new(m.Id, m.Kind, m.FileName, m.ContentType, m.Size);

    /// <summary>Trình duyệt đã PUT xong → kiểm tra trên S3 (có thật, đúng giới hạn). Chỉ người xin link.</summary>
    private static async Task<Results<Ok<SocialMediaDto>, NotFound, ValidationProblem, ProblemHttpResult>> ConfirmMediaAsync(Guid id, ClaimsPrincipal user,
        AssetsDbContext db, IFileStorage files, CancellationToken ct)
    {
        var m = await db.SocialMedia.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (m is null || m.CreatedByUserId != user.GetUserId()) return TypedResults.NotFound();
        if (m.Ready) return TypedResults.Ok(ToDto(m));
        // TEST-13: chép key tạm → key chính rồi kiểm cỡ + chữ ký trên bản đã chép (link PUT còn hạn không thay được file đã xác nhận)
        var check = await files.PromoteUploadAsync(m.FileKey, m.FileName, ct);
        if (check.Error is { } bad)
        {
            db.SocialMedia.Remove(m);
            await db.SaveChangesAsync(ct);
            return new Validation().Add("fileName", bad).Problem();
        }
        var size = check.Size;
        if (size is null) return Problems.Conflict("Tệp chưa tải lên xong — thử lại");
        var max = m.Kind == SocialMediaKind.Video ? SocialRules.MaxVideoBytes : SocialRules.MaxImageBytes;
        if (size.Value <= 0 || size.Value > max)
        {
            await files.DeleteAsync(m.FileKey, ct);
            db.SocialMedia.Remove(m);
            await db.SaveChangesAsync(ct);
            return new Validation().Add("size", m.Kind == SocialMediaKind.Video ? "Video tối đa 1 GB" : "Ảnh tối đa 10 MB").Problem();
        }
        m.Size = size.Value;
        m.Ready = true;
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToDto(m));
    }

    private static async Task<Results<Ok<FileUrlDto>, NotFound>> MediaUrlAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        IFileStorage files, CancellationToken ct)
    {
        var m = await db.SocialMedia.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Ready, ct);
        if (m is null) return TypedResults.NotFound();
        var me = await access.ViewerAsync(user, ct);
        if (m.CreatedByUserId != me.UserId && !me.IsHr)
        {
            if (m.PostId is not { } pid) return TypedResults.NotFound();
            var held = await HeldPageIdsAsync(me, db, ct);
            if (!await db.SocialTargets.AnyAsync(t => t.PostId == pid && held.Contains(t.PageId), ct)) return TypedResults.NotFound();
        }
        return TypedResults.Ok(new FileUrlDto(await files.GetDownloadUrlAsync(m.FileKey, m.FileName, true, TimeSpan.FromMinutes(10))));
    }

    // ---------------- Bài đăng ----------------

    private static async Task<List<SocialPostDto>> ToDtosAsync(IReadOnlyList<SocialPost> posts, Viewer me, AssetsDbContext db, CancellationToken ct)
    {
        var ids = posts.Select(p => p.Id).ToList();
        var targets = await db.SocialTargets.AsNoTracking().Where(t => ids.Contains(t.PostId)).ToListAsync(ct);
        var pageIds = targets.Select(t => t.PageId).Distinct().ToList();
        var pages = await db.SocialPages.AsNoTracking().Where(p => pageIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var media = await db.SocialMedia.AsNoTracking().Where(m => m.PostId != null && ids.Contains(m.PostId.Value) && m.Ready).OrderBy(m => m.SortOrder)
            .ToListAsync(ct);
        var targetIds = targets.Select(t => t.Id).ToList();
        // Bài đăng từ OfficeHub đã bị xoá trên Facebook (TEST-211)
        var deleted = (await db.SocialPagePosts.AsNoTracking()
            .Where(x => x.PostTargetId != null && targetIds.Contains(x.PostTargetId.Value) && x.DeletedAt != null)
            .Select(x => new { x.PostTargetId, x.DeletedAt }).ToListAsync(ct))
            .DistinctBy(x => x.PostTargetId).ToDictionary(x => x.PostTargetId!.Value, x => x.DeletedAt);
        var held = await HeldPageIdsAsync(me, db, ct);
        var postable = me.IsHr
            ? (await (from p in db.SocialPages.AsNoTracking() join a in db.SocialAccounts.AsNoTracking() on p.AccountId equals a.Id
                      where pageIds.Contains(p.Id) && a.Status == SocialAccountStatus.Active select p.Id).ToListAsync(ct)).ToHashSet()
            : held;
        return [.. posts.Select(p =>
        {
            var ts = targets.Where(t => t.PostId == p.Id).OrderBy(t => pages.GetValueOrDefault(t.PageId)?.Name).ToList();
            var manage = me.IsHr || p.AuthorUserId == me.UserId || ts.Any(t => held.Contains(t.PageId));
            var canEdit = SocialRules.CanEditAuthor(me.IsHr, me.UserId, p.AuthorUserId)
                && SocialRules.CannotEditPost([.. ts.Select(t => (t.Status, t.Attempts))]) is null;
            return new SocialPostDto(p.Id, p.Message, p.Link, p.ScheduledAt, p.CreatedAt, p.AuthorName, SocialRules.PostStatus([.. ts.Select(t => t.Status)]),
                [.. ts.Select(t =>
                {
                    var pg = pages.GetValueOrDefault(t.PageId);
                    var canRetry = t.Status == SocialTargetStatus.Failed && postable.Contains(t.PageId) && pg is { IsActive: true, TokenEncrypted: not null };
                    return new SocialTargetDto(t.Id, t.PageId, pg?.Name ?? "(trang đã xoá)", pg?.PictureUrl, t.Status, t.DueAt, t.Attempts, t.PublishedAt,
                        t.Permalink, t.Error, t.CancelledAt, t.CancelledByName, canRetry, deleted.GetValueOrDefault(t.Id)?.ToUniversalTime());
                })],
                [.. media.Where(m => m.PostId == p.Id).Select(ToDto)],
                manage && ts.Any(t => t.Status == SocialTargetStatus.Pending), canEdit, p.EditedAt, p.EditedByName);
        })];
    }

    /// <summary>HR: mọi bài; nhân viên: bài mình đăng + bài lên trang thuộc BM mình đang giữ.</summary>
    private static async Task<IQueryable<SocialPost>> VisibleAsync(Viewer me, AssetsDbContext db, CancellationToken ct)
    {
        var q = db.SocialPosts.AsNoTracking();
        if (me.IsHr) return q;
        var held = (await HeldPageIdsAsync(me, db, ct)).ToList();
        var uid = me.UserId;
        return q.Where(p => p.AuthorUserId == uid || db.SocialTargets.Any(t => t.PostId == p.Id && held.Contains(t.PageId)));
    }

    private static async Task<Results<Ok<PagedResult<SocialPostDto>>, ProblemHttpResult>> ListAsync(int? page, int? pageSize, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var rows = await (await VisibleAsync(me, db, ct)).OrderByDescending(p => p.CreatedAt).ThenByDescending(p => p.Id)
            .ToPagedAsync(page ?? 1, pageSize, ct);
        return TypedResults.Ok(rows.With(await ToDtosAsync(rows.Items, me, db, ct)));
    }

    private static async Task<Results<Ok<SocialPostDto>, ProblemHttpResult>> GetAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db, AssetAccess access,
        CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var p = await (await VisibleAsync(me, db, ct)).FirstOrDefaultAsync(x => x.Id == id, ct);
        return p is null ? Problems.NotFound("bài đăng") : TypedResults.Ok((await ToDtosAsync([p], me, db, ct))[0]);
    }

    private static async Task<Results<Ok<SocialPostDto>, ValidationProblem, ProblemHttpResult>> CreateAsync(SocialPostRequest r, ClaimsPrincipal user,
        AssetsDbContext db, AssetAccess access, AssetClock clock, SocialPublishSignal signal, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var accountIds = await PostableAccountIdsAsync(me, db, ct);
        if (accountIds.Count == 0) return NoAccount(me);

        var pageIds = (r.PageIds ?? []).Distinct().ToList();
        var mediaIds = (r.MediaIds ?? []).Distinct().ToList();
        var pages = await db.SocialPages.AsNoTracking().Where(p => pageIds.Contains(p.Id)).ToListAsync(ct);
        var media = await db.SocialMedia.Where(m => mediaIds.Contains(m.Id)).ToListAsync(ct);
        var now = clock.Now;
        var link = string.IsNullOrWhiteSpace(r.Link) ? null : r.Link.Trim();
        var v = new Validation();
        foreach (var (field, msg) in SocialRules.ValidatePost(r.Message, link, pageIds.Count, [.. media.Select(m => m.Kind)], r.ScheduledAt, now))
            v.Add(field, msg);
        if (pages.Count != pageIds.Count) v.Add("pageIds", "Có trang không tồn tại");
        foreach (var p in pages.Where(p => !accountIds.Contains(p.AccountId) || !p.IsActive))
            v.Add("pageIds", $"Bạn không được đăng lên trang \"{p.Name}\"");
        foreach (var p in pages.Where(p => accountIds.Contains(p.AccountId) && p.IsActive && p.TokenEncrypted is null))
            v.Add("pageIds", $"Chưa có quyền đăng lên trang \"{p.Name}\" — nhờ HR kiểm tra quyền System User rồi đồng bộ lại");
        if (media.Count != mediaIds.Count || media.Any(m => m.CreatedByUserId != me.UserId || !m.Ready || m.PostId is not null))
            v.Add("mediaIds", "Ảnh / video không hợp lệ hoặc đã dùng cho bài khác — tải lên lại");
        if (v.Failed) return v.Problem();

        var post = new SocialPost
        {
            Message = r.Message?.Trim() ?? "", Link = link, ScheduledAt = r.ScheduledAt, CreatedAt = now, AuthorUserId = me.UserId,
            AuthorEmployeeId = me.Employee?.Id, AuthorName = me.Name,
        };
        foreach (var pid in pageIds)
            post.Targets.Add(new SocialPostTarget { PostId = post.Id, PageId = pid, Status = SocialTargetStatus.Pending, DueAt = r.ScheduledAt ?? now });
        db.SocialPosts.Add(post);
        for (var i = 0; i < mediaIds.Count; i++)
        {
            var m = media.First(x => x.Id == mediaIds[i]);
            m.PostId = post.Id;
            m.SortOrder = i;
        }
        await db.SaveChangesAsync(ct);
        if (r.ScheduledAt is null) signal.Poke();
        return TypedResults.Ok((await ToDtosAsync([post], me, db, ct))[0]);
    }

    /// <summary>
    /// Sửa bài đã hẹn còn chờ (TEST-208): nội dung, link, ảnh / video (thêm / bỏ / đổi thứ tự), trang đích, giờ hẹn hoặc chuyển sang đăng ngay.
    /// Chỉ người đăng + HR (người giữ BM chỉ huỷ được). Chạy trong một transaction, khoá mọi dòng đích của bài (<c>FOR UPDATE</c>) rồi mới kiểm tra
    /// <see cref="SocialRules.CannotEditPost"/>: job đã nhận một đích trước → 409; sửa giữ khoá trước → job chờ commit rồi đăng nội dung mới
    /// (điều kiện nhận đích của <see cref="SocialService.PublishTargetAsync"/> đánh giá lại trên dòng đã sửa).
    /// </summary>
    private static async Task<Results<Ok<SocialPostDto>, ValidationProblem, ProblemHttpResult>> UpdateAsync(Guid id, SocialPostRequest r,
        ClaimsPrincipal user, AssetsDbContext db, AssetAccess access, AssetClock clock, SocialPublishSignal signal, IFileStorage files,
        CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var visible = await (await VisibleAsync(me, db, ct)).AnyAsync(x => x.Id == id, ct);
        if (!visible) return Problems.NotFound("bài đăng");
        var accountIds = await PostableAccountIdsAsync(me, db, ct);

        List<string> dropKeys;
        SocialPost post;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            // Khoá các đích trước mọi kiểm tra: job đăng nhận đích bằng UPDATE có điều kiện nên phải chờ transaction này.
            var targets = await db.SocialTargets
                .FromSqlInterpolated($"SELECT * FROM assets.social_post_targets WHERE \"PostId\" = {id} FOR UPDATE").ToListAsync(ct);
            post = await db.SocialPosts.FirstAsync(x => x.Id == id, ct);
            if (!SocialRules.CanEditAuthor(me.IsHr, me.UserId, post.AuthorUserId))
                return Forbidden("Chỉ người đăng bài hoặc HR được sửa bài — bạn chỉ huỷ được phần chưa đăng");
            if (SocialRules.CannotEditPost([.. targets.Select(t => (t.Status, t.Attempts))]) is { } why) return Problems.Conflict(why);
            if (accountIds.Count == 0) return NoAccount(me);

            var pageIds = (r.PageIds ?? []).Distinct().ToList();
            var mediaIds = (r.MediaIds ?? []).Distinct().ToList();
            var pages = await db.SocialPages.AsNoTracking().Where(p => pageIds.Contains(p.Id)).ToListAsync(ct);
            var current = await db.SocialMedia.Where(m => m.PostId == id).ToListAsync(ct);
            var added = await db.SocialMedia.Where(m => mediaIds.Contains(m.Id) && m.PostId != id).ToListAsync(ct);
            var now = clock.Now;
            var link = string.IsNullOrWhiteSpace(r.Link) ? null : r.Link.Trim();
            var v = new Validation();
            var kinds = mediaIds.Select(mid => current.FirstOrDefault(m => m.Id == mid && m.Ready) ?? added.FirstOrDefault(m => m.Id == mid))
                .Where(m => m is not null).Select(m => m!.Kind).ToList();
            foreach (var (field, msg) in SocialRules.ValidatePost(r.Message, link, pageIds.Count, kinds, r.ScheduledAt, now)) v.Add(field, msg);
            if (pages.Count != pageIds.Count) v.Add("pageIds", "Có trang không tồn tại");
            foreach (var p in pages.Where(p => !accountIds.Contains(p.AccountId) || !p.IsActive))
                v.Add("pageIds", $"Bạn không được đăng lên trang \"{p.Name}\"");
            foreach (var p in pages.Where(p => accountIds.Contains(p.AccountId) && p.IsActive && p.TokenEncrypted is null))
                v.Add("pageIds", $"Chưa có quyền đăng lên trang \"{p.Name}\" — nhờ HR kiểm tra quyền System User rồi đồng bộ lại");
            if (kinds.Count != mediaIds.Count || added.Any(m => m.CreatedByUserId != me.UserId || !m.Ready || m.PostId is not null))
                v.Add("mediaIds", "Ảnh / video không hợp lệ hoặc đã dùng cho bài khác — tải lên lại");
            if (v.Failed) return v.Problem();

            post.Message = r.Message?.Trim() ?? "";
            post.Link = link;
            post.ScheduledAt = r.ScheduledAt;
            post.EditedAt = now;
            post.EditedByName = me.Name;
            var due = r.ScheduledAt ?? now;
            foreach (var t in targets.Where(t => t.Status == SocialTargetStatus.Pending && !pageIds.Contains(t.PageId)))
                db.SocialTargets.Remove(t); // trang bị bỏ: đích chưa từng chạy → xoá dòng
            foreach (var pid in pageIds)
            {
                var t = targets.FirstOrDefault(x => x.PageId == pid && x.Status == SocialTargetStatus.Pending)
                    ?? targets.FirstOrDefault(x => x.PageId == pid && x.Status == SocialTargetStatus.Cancelled);
                if (t is null)
                {
                    db.SocialTargets.Add(new SocialPostTarget { PostId = id, PageId = pid, Status = SocialTargetStatus.Pending, DueAt = due });
                    continue;
                }
                t.Status = SocialTargetStatus.Pending; // trang đã huỷ được chọn lại → chờ đăng lại từ đầu
                t.DueAt = due;
                t.Attempts = 0;
                t.Error = null;
                t.CancelledAt = null;
                t.CancelledByName = null;
            }
            var dropped = current.Where(m => !mediaIds.Contains(m.Id)).ToList();
            dropKeys = [.. dropped.Select(m => m.FileKey)];
            db.SocialMedia.RemoveRange(dropped);
            for (var i = 0; i < mediaIds.Count; i++)
            {
                var m = current.FirstOrDefault(x => x.Id == mediaIds[i]) ?? added.First(x => x.Id == mediaIds[i]);
                m.PostId = id;
                m.SortOrder = i;
            }
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }

        // Tệp bị bỏ: xoá trên S3 sau khi commit (transaction lỗi thì tệp vẫn còn cho bài cũ)
        foreach (var key in dropKeys)
        {
            try { await files.DeleteAsync(key, CancellationToken.None); }
            catch (Exception) { /* tệp mồ côi trên S3 không ảnh hưởng bài; không làm hỏng lần sửa đã commit */ }
        }
        if (r.ScheduledAt is null) signal.Poke();
        return TypedResults.Ok((await ToDtosAsync([post], me, db, ct))[0]);
    }

    /// <summary>Huỷ các trang chưa đăng (Chờ). HR, người đăng, người giữ BM của trang.</summary>
    private static async Task<Results<Ok<SocialPostDto>, ProblemHttpResult>> CancelAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, AssetClock clock, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var post = await (await VisibleAsync(me, db, ct)).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (post is null) return Problems.NotFound("bài đăng");
        var held = await HeldPageIdsAsync(me, db, ct);
        var all = me.IsHr || post.AuthorUserId == me.UserId;
        var pending = await db.SocialTargets.Where(t => t.PostId == id && t.Status == SocialTargetStatus.Pending).ToListAsync(ct);
        var mine = pending.Where(t => all || held.Contains(t.PageId)).ToList();
        if (mine.Count == 0) return Problems.Conflict("Không còn trang nào đang chờ đăng");
        foreach (var t in mine)
        {
            t.Status = SocialTargetStatus.Cancelled;
            t.CancelledAt = clock.Now;
            t.CancelledByName = me.Name;
        }
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok((await ToDtosAsync([post], me, db, ct))[0]);
    }

    /// <summary>Đăng lại một trang bị lỗi (ngay). Người còn quyền đăng lên trang đó (HR / người đang giữ BM).</summary>
    private static async Task<Results<Ok<SocialPostDto>, ProblemHttpResult>> RetryAsync(Guid id, ClaimsPrincipal user, AssetsDbContext db,
        AssetAccess access, AssetClock clock, SocialPublishSignal signal, CancellationToken ct)
    {
        var me = await access.ViewerAsync(user, ct);
        var t = await db.SocialTargets.FirstOrDefaultAsync(x => x.Id == id, ct);
        var post = t is null ? null : await (await VisibleAsync(me, db, ct)).FirstOrDefaultAsync(x => x.Id == t.PostId, ct);
        if (t is null || post is null) return Problems.NotFound("bài đăng");
        if (t.Status != SocialTargetStatus.Failed) return Problems.Conflict("Chỉ đăng lại được trang bị lỗi");
        var page = await db.SocialPages.AsNoTracking().FirstAsync(p => p.Id == t.PageId, ct);
        if (!(await PostableAccountIdsAsync(me, db, ct)).Contains(page.AccountId)) return Forbidden("Bạn không còn quyền đăng lên trang này");
        if (!page.IsActive || page.TokenEncrypted is null) return Problems.Conflict("Chưa có quyền đăng lên trang này — nhờ HR đồng bộ lại BM");
        t.Status = SocialTargetStatus.Pending;
        t.DueAt = clock.Now;
        t.Attempts = 0;
        t.Error = null;
        await db.SaveChangesAsync(ct);
        signal.Poke();
        return TypedResults.Ok((await ToDtosAsync([post], me, db, ct))[0]);
    }
}
